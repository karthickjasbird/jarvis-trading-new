import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { AudioRecorder, AudioPlayer } from '../utils/audioUtils';
import { toast } from 'sonner';

const setAlarmTool: FunctionDeclaration = {
  name: 'setAlarm',
  description: 'Set an alarm for a specific time.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      time: { type: Type.STRING, description: 'The time for the alarm (e.g., "08:00 AM", "14:30")' },
      label: { type: Type.STRING, description: 'The label or name for the alarm' }
    },
    required: ['time']
  }
};

const setReminderTool: FunctionDeclaration = {
  name: 'setReminder',
  description: 'Set a reminder to notify the user about something after a certain delay.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      message: { type: Type.STRING, description: 'The reminder message' },
      delayMinutes: { type: Type.NUMBER, description: 'Delay in minutes from now' }
    },
    required: ['message', 'delayMinutes']
  }
};

const openAppTool: FunctionDeclaration = {
  name: 'openApp',
  description: 'Open a web application or website (e.g., Spotify, YouTube, Gmail).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      appName: { type: Type.STRING, description: 'The name of the app or website to open' },
      url: { type: Type.STRING, description: 'The URL of the app or website to open' }
    },
    required: ['appName', 'url']
  }
};

const activateSentryModeTool: FunctionDeclaration = {
  name: 'activateSentryMode',
  description: 'Activate Sentry Mode for autonomous trading. Use this when the user asks to start trading autonomously or go to sleep.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      maxDailyLoss: { type: Type.NUMBER, description: 'The maximum allowed daily loss in currency before halting trading' },
      targetDailyProfit: { type: Type.NUMBER, description: 'The target daily profit in currency' }
    },
    required: ['maxDailyLoss']
  }
};

const getMarketPriceTool: FunctionDeclaration = {
  name: 'getMarketPrice',
  description: 'Get the real-time market price for a specific symbol (e.g., "BTC/USDT", "ETH/USDT", "RELIANCE").',
  parameters: {
    type: Type.OBJECT,
    properties: {
      symbol: { type: Type.STRING, description: 'The trading symbol to look up' }
    },
    required: ['symbol']
  }
};

const executeTradeTool: FunctionDeclaration = {
  name: 'executeTrade',
  description: 'Execute a market order to buy or sell a specific symbol.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      symbol: { type: Type.STRING, description: 'The trading symbol (e.g., "BTC/USDT")' },
      side: { type: Type.STRING, description: 'The side of the trade: "buy" or "sell"' },
      quantity: { type: Type.NUMBER, description: 'The amount to trade' }
    },
    required: ['symbol', 'side', 'quantity']
  }
};

export function useJarvisLive() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [volume, setVolume] = useState(0);

  const sessionRef = useRef<any>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoIntervalRef = useRef<number | null>(null);
  const lastSpeakerRef = useRef<'user' | 'jarvis' | null>(null);

  const startSession = useCallback(async (memoryContext: string, enableScreenShare: boolean, enableSearch: boolean, personality: 'classic' | 'sarcastic' | 'scientific' = 'classic') => {
    if (isConnected || isConnecting) return;

    setIsConnecting(true);
    setTranscript('');
    lastSpeakerRef.current = null;

    recorderRef.current = new AudioRecorder();
    playerRef.current = new AudioPlayer();

    recorderRef.current.onVolumeChange = (vol) => {
      if (!isSpeaking) {
        setVolume(vol);
      }
    };

    playerRef.current.onVolumeChange = (vol) => {
      if (isSpeaking) {
        setVolume(vol);
      }
    };

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      let location = null;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
        });
        location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      } catch (e) {
        console.warn('Could not get location', e);
      }

      if (enableScreenShare) {
        try {
          videoStreamRef.current = await navigator.mediaDevices.getDisplayMedia({ video: true });
        } catch (e) {
          console.warn('Screen share cancelled or failed', e);
          toast.error('Screen sharing was cancelled or blocked.');
          setIsConnecting(false);
          return;
        }
      }

      try {
        await recorderRef.current.start();
      } catch (e) {
        console.error('Failed to start audio recording:', e);
        toast.error('Microphone access denied or failed. Please check permissions.');
        setIsConnecting(false);
        return;
      }

      const personalityInstructions = {
        classic: 'You are Jarvis, a highly advanced personal AI assistant. You are helpful, concise, and capable.',
        sarcastic: 'You are Jarvis, but with a sharp, sarcastic wit similar to Tony Stark. You are still helpful, but you make jokes and have a bit of an attitude.',
        scientific: 'You are Jarvis, acting as a deep scientific researcher. You are extremely analytical, use technical terminology, and focus on data and logic.'
      };

      const systemInstruction = `${personalityInstructions[personality]} You have access to the user's screen if they shared it, and you can see what they are looking at. You also have access to past conversation summaries to maintain context.
      
User Location: ${location ? `Lat: ${location.lat}, Lng: ${location.lng}` : 'Unknown'}
Past Context:
${memoryContext}

Be conversational, smooth, and act like a real assistant. Keep responses relatively brief unless asked for details. If you need to search the web for real-time info like weather or news, use the Google Search tool. 
If the user asks about crypto or stock prices, ALWAYS use the getMarketPrice tool to fetch the live price before answering.
If the user asks to buy or sell, use the executeTrade tool.
If the user asks you to start trading autonomously or go to sleep while managing trades, use the activateSentryMode tool.`;

      const sessionPromise = ai.live.connect({
        model: 'gemini-3.1-flash-live-preview',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          tools: [
            ...(enableSearch ? [{ googleSearch: {} }] : []),
            { functionDeclarations: [setAlarmTool, setReminderTool, openAppTool, activateSentryModeTool, getMarketPriceTool, executeTradeTool] }
          ],
          systemInstruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setIsConnecting(false);
            setIsListening(true);

            recorderRef.current!.onData = (base64Data) => {
              sessionPromise.then((session) => {
                session.sendRealtimeInput({
                  audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' },
                });
              });
            };

            if (videoStreamRef.current) {
              const video = document.createElement('video');
              video.muted = true;
              video.playsInline = true;
              video.srcObject = videoStreamRef.current;
              video.play();
              
              videoIntervalRef.current = window.setInterval(() => {
                try {
                  const canvas = document.createElement('canvas');
                  canvas.width = video.videoWidth || 640;
                  canvas.height = video.videoHeight || 480;
                  const ctx = canvas.getContext('2d');
                  if (ctx && video.videoWidth > 0) {
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const base64Data = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
                    
                    sessionPromise.then((session) => {
                      session.sendRealtimeInput({
                        video: { data: base64Data, mimeType: 'image/jpeg' },
                      });
                    });
                  }
                } catch (e) {
                  console.error('Error capturing frame', e);
                }
              }, 2000); // Send frame every 2 seconds
            }
          },
          onmessage: async (message: LiveServerMessage) => {
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              setIsSpeaking(true);
              playerRef.current?.playBase64Audio(base64Audio);
            }

            if (message.serverContent?.interrupted) {
              playerRef.current?.stop();
              setIsSpeaking(false);
            }

            if (message.serverContent?.turnComplete) {
              // Add a small delay to let the audio finish playing before stopping the animation
              setTimeout(() => setIsSpeaking(false), 1000);
            }

            if (message.serverContent?.modelTurn?.parts[0]?.text) {
              const text = message.serverContent.modelTurn.parts[0].text;
              const prefix = lastSpeakerRef.current !== 'jarvis' ? '\n\nJarvis: ' : '';
              setTranscript((prev) => prev + (prev && prefix ? prefix : (prefix ? 'Jarvis: ' : '')) + text);
              lastSpeakerRef.current = 'jarvis';
            }

            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.functionCall) {
                  const call = part.functionCall;
                  let response = {};
                  
                  if (call.name === 'setAlarm') {
                    const { time, label } = call.args as any;
                    toast.success(`Alarm set for ${time} ${label ? `(${label})` : ''}`);
                    response = { status: 'success', message: `Alarm set for ${time}` };
                  } else if (call.name === 'setReminder') {
                    const { message, delayMinutes } = call.args as any;
                    toast.success(`Reminder set: "${message}" in ${delayMinutes} minutes`);
                    setTimeout(() => {
                      toast.info(`Reminder: ${message}`, { duration: 10000 });
                    }, delayMinutes * 60 * 1000);
                    response = { status: 'success', message: `Reminder set for ${delayMinutes} minutes` };
                  } else if (call.name === 'openApp') {
                    const { appName, url } = call.args as any;
                    toast.success(`Opening ${appName}...`);
                    window.open(url, '_blank');
                    response = { status: 'success', message: `Opened ${appName} at ${url}` };
                  } else if (call.name === 'activateSentryMode') {
                    const { maxDailyLoss, targetDailyProfit } = call.args as any;
                    toast.success(`Sentry Mode Activated! Max Loss: ${maxDailyLoss}, Target: ${targetDailyProfit || 'None'}`, {
                      style: { backgroundColor: '#3b82f6', color: 'white', border: 'none' },
                      duration: 5000
                    });
                    response = { status: 'success', message: `Sentry Mode activated successfully with max loss ${maxDailyLoss}` };
                  } else if (call.name === 'getMarketPrice') {
                    const { symbol } = call.args as any;
                    try {
                      const res = await fetch(`/api/market-data?symbol=${encodeURIComponent(symbol)}&broker=crypto`);
                      const data = await res.json();
                      response = { status: 'success', price: data.price, change: data.change, symbol: data.symbol };
                    } catch (e) {
                      response = { status: 'error', message: 'Failed to fetch market price' };
                    }
                  } else if (call.name === 'executeTrade') {
                    const { symbol, side, quantity } = call.args as any;
                    toast.success(`Executing Trade: ${side.toUpperCase()} ${quantity} ${symbol}`, {
                      style: { backgroundColor: side.toLowerCase() === 'buy' ? '#22c55e' : '#ef4444', color: 'white', border: 'none' },
                      duration: 5000
                    });
                    response = { status: 'success', message: `Trade executed: ${side} ${quantity} ${symbol}` };
                  }

                  sessionPromise.then(session => {
                    session.sendToolResponse({
                      functionResponses: [{
                        name: call.name,
                        id: call.id,
                        response: response
                      }]
                    });
                  });
                }
              }
            }

            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              const finished = message.serverContent.inputTranscription.finished;
              if (text) {
                const prefix = lastSpeakerRef.current !== 'user' ? '\n\nYou: ' : '';
                setTranscript((prev) => prev + (prev && prefix ? prefix : (prefix ? 'You: ' : '')) + text);
                lastSpeakerRef.current = 'user';
              }
              if (finished) {
                lastSpeakerRef.current = null;
              }
            }

            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              const finished = message.serverContent.outputTranscription.finished;
              if (text) {
                const prefix = lastSpeakerRef.current !== 'jarvis' ? '\n\nJarvis: ' : '';
                setTranscript((prev) => prev + (prev && prefix ? prefix : (prefix ? 'Jarvis: ' : '')) + text);
                lastSpeakerRef.current = 'jarvis';
              }
              if (finished) {
                lastSpeakerRef.current = null;
              }
            }
          },
          onclose: () => {
            stopSession();
          },
          onerror: (error) => {
            console.error('Live API Error:', error);
            if (error instanceof Error && error.message.includes('Network error')) {
              toast.error('Network error: Connection to Jarvis was lost or blocked. Please try again.');
            } else {
              toast.error('An error occurred with the Jarvis connection.');
            }
            stopSession();
          },
        },
      });

      sessionRef.current = sessionPromise;
    } catch (error) {
      console.error('Failed to start session:', error);
      setIsConnecting(false);
      stopSession();
    }
  }, [isConnected, isConnecting]);

  const stopSession = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.then((session: any) => session.close());
      sessionRef.current = null;
    }
    if (recorderRef.current) {
      recorderRef.current.stop();
      recorderRef.current = null;
    }
    if (playerRef.current) {
      playerRef.current.stop();
      playerRef.current = null;
    }
    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(t => t.stop());
      videoStreamRef.current = null;
    }

    setIsConnected(false);
    setIsConnecting(false);
    setIsListening(false);
    setIsSpeaking(false);
    setVolume(0);
  }, []);

  return {
    startSession,
    stopSession,
    isConnected,
    isConnecting,
    isListening,
    isSpeaking,
    transcript,
    volume,
  };
}
