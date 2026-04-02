import { useState, useEffect, useRef, useCallback } from 'react';

export function useWakeWord(wakeWord: string, onWake: () => void) {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const shouldListenRef = useRef(false);

  const stopListening = useCallback(() => {
    shouldListenRef.current = false;
    setIsListening(false);
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, []);

  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Speech recognition is not supported in this browser.');
      return;
    }

    setError(null);
    shouldListenRef.current = true;
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
    };

    recognition.onresult = (event: any) => {
      // Loop through all results since last check
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          const transcript = event.results[i][0].transcript.trim().toLowerCase();
          if (transcript.includes(wakeWord.toLowerCase())) {
            onWake();
          }
        }
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted' && event.error !== 'network') {
        console.error('Speech recognition error', event.error);
        setError(event.error);
      }
    };

    recognition.onend = () => {
      // Restart if it stops automatically and we still want to listen
      if (shouldListenRef.current) {
        // Use a small timeout to avoid immediate restart which can cause 'aborted'
        setTimeout(() => {
          if (shouldListenRef.current) {
            try {
              recognition.start();
            } catch (e) {
              // Ignore if already started or other minor errors
              if (!(e instanceof Error && e.message.includes('already started'))) {
                console.error('Failed to restart recognition', e);
              }
            }
          }
        }, 100);
      } else {
        setIsListening(false);
      }
    };

    try {
      recognition.start();
    } catch (e) {
      console.error('Failed to start recognition', e);
    }

    return stopListening;
  }, [wakeWord, onWake, stopListening]);

  return { startListening, stopListening, isListening, error };
}
