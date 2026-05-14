import React, { useState, useEffect } from 'react';
import { collection, query, getDocs, addDoc, deleteDoc, doc, updateDoc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { User } from 'firebase/auth';
import { Settings, Key, Plus, Trash2, CheckCircle2, XCircle, ShieldCheck, Send, Palette, Brain, Lock } from 'lucide-react';
import { toast } from 'sonner';

interface BrokerConfig {
  id: string;
  brokerName: string;
  apiKey: string;
  apiSecret: string;
  isActive: boolean;
  updatedAt: string;
  accessToken?: string;
  lastLogin?: string;
}

interface NotificationConfig {
  telegramChatId: string;
  enabled: boolean;
}

const BROKERS = [
  { id: 'zerodha', name: 'Zerodha (Kite Connect)', type: 'indian_equity' },
  { id: 'upstox', name: 'Upstox', type: 'indian_equity' },
  { id: 'binance', name: 'Binance', type: 'crypto' },
  { id: 'bybit', name: 'Bybit', type: 'crypto' },
  { id: 'paper', name: 'Paper Trading (Simulator)', type: 'simulator' }
];

type OrbVariant = 'hologram' | 'liquid' | 'ethereal';

export function BrokerSettings({ 
  user, 
  onClose,
  personality,
  setPersonality,
  orbVariant,
  setOrbVariant
}: { 
  user: User, 
  onClose: () => void,
  personality?: 'classic' | 'sarcastic' | 'scientific',
  setPersonality?: (p: 'classic' | 'sarcastic' | 'scientific') => void,
  orbVariant?: OrbVariant,
  setOrbVariant?: (v: OrbVariant) => void
}) {
  const [configs, setConfigs] = useState<BrokerConfig[]>([]);
  const [notificationConfig, setNotificationConfig] = useState<NotificationConfig>({ telegramChatId: '', enabled: false });
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newConfig, setNewConfig] = useState({ brokerName: 'zerodha', apiKey: '', apiSecret: '' });
  const [activeTab, setActiveTab] = useState<'brokers' | 'notifications' | 'preferences' | 'apikeys'>('brokers');
  const [testingId, setTestingId] = useState<string | null>(null);
  
  // Per-user API Keys
  const [userKeys, setUserKeys] = useState({
    geminiApiKey: '',
    binanceApiKey: '',
    binanceSecretKey: '',
    telegramBotToken: '',
    telegramChatId: '',
  });
  const [keyStatus, setKeyStatus] = useState({ hasGemini: false, hasBinance: false, hasTelegram: false });
  const [savingKeys, setSavingKeys] = useState(false);

  const testConnection = async (configId: string) => {
    setTestingId(configId);
    try {
      const res = await fetch(`/api/broker/test/${user.uid}`, { method: 'POST' });
      const data = await res.json();
      if (data.connected) {
        toast.success(data.message, {
          description: `Balance: ${data.totalBalance} ${data.currency}`,
          duration: 5000
        });
      } else {
        toast.error('Connection Failed', { description: data.error, duration: 5000 });
      }
    } catch (err: any) {
      toast.error('Test failed', { description: err.message });
    } finally {
      setTestingId(null);
    }
  };

  useEffect(() => {
    fetchConfigs();
    fetchNotificationConfig();
    fetchUserKeys();
  }, [user]);

  const fetchUserKeys = async () => {
    try {
      const res = await fetch(`/api/secrets/${user.uid}`);
      const data = await res.json();
      if (data.secrets) {
        setKeyStatus({
          hasGemini: data.secrets.hasGemini,
          hasBinance: data.secrets.hasBinance,
          hasTelegram: data.secrets.hasTelegram,
        });
      }
    } catch {}
  };

  const saveUserKeys = async () => {
    setSavingKeys(true);
    try {
      // Only send non-empty fields
      const payload: Record<string, string> = {};
      if (userKeys.geminiApiKey) payload.geminiApiKey = userKeys.geminiApiKey;
      if (userKeys.binanceApiKey) payload.binanceApiKey = userKeys.binanceApiKey;
      if (userKeys.binanceSecretKey) payload.binanceSecretKey = userKeys.binanceSecretKey;
      if (userKeys.telegramBotToken) payload.telegramBotToken = userKeys.telegramBotToken;
      if (userKeys.telegramChatId) payload.telegramChatId = userKeys.telegramChatId;

      const res = await fetch(`/api/secrets/${user.uid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.status === 'success') {
        toast.success('API keys saved securely!');
        setUserKeys({ geminiApiKey: '', binanceApiKey: '', binanceSecretKey: '', telegramBotToken: '', telegramChatId: '' });
        await fetchUserKeys();
      } else {
        toast.error('Failed to save keys');
      }
    } catch {
      toast.error('Failed to save API keys');
    } finally {
      setSavingKeys(false);
    }
  };

  const fetchNotificationConfig = async () => {
    try {
      const docRef = doc(db, 'notificationConfigs', user.uid);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        setNotificationConfig(snap.data() as NotificationConfig);
      }
    } catch (error) {
      console.error("Error fetching notification config:", error);
    }
  };

  const saveNotificationConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await setDoc(doc(db, 'notificationConfigs', user.uid), {
        ...notificationConfig,
        updatedAt: new Date().toISOString()
      });
      toast.success("Notification settings saved!");
    } catch (error) {
      console.error("Error saving notification config:", error);
      toast.error("Failed to save notification settings");
    }
  };

  const fetchConfigs = async () => {
    try {
      const q = query(collection(db, 'users', user.uid, 'brokerConfigs'));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BrokerConfig));
      setConfigs(data);
    } catch (error) {
      console.error("Error fetching configs:", error);
      toast.error("Failed to load broker configurations");
    } finally {
      setLoading(false);
    }
  };

  const handleDailyLogin = (config: BrokerConfig) => {
    if (config.brokerName !== 'zerodha') return;

    const loginUrl = `https://kite.zerodha.com/connect/login?v=3&api_key=${config.apiKey}`;
    const popup = window.open(loginUrl, 'ZerodhaLogin', 'width=500,height=600');

    const messageListener = async (event: MessageEvent) => {
      if (event.data?.type === 'ZERODHA_AUTH') {
        window.removeEventListener('message', messageListener);
        if (event.data.status === 'success' && event.data.request_token) {
          try {
            toast.loading("Exchanging token...", { id: "zerodha-auth" });
            const res = await fetch('/api/broker/zerodha/exchange-token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: user.uid,
                requestToken: event.data.request_token,
                configId: config.id
              })
            });
            
            if (!res.ok) {
              const errorData = await res.json();
              throw new Error(errorData.error || "Failed to exchange token");
            }
            
            toast.success("Zerodha authenticated for the day!", { id: "zerodha-auth" });
            fetchConfigs(); // Refresh UI to show updated login status
          } catch (err: any) {
            console.error("Auth error:", err);
            toast.error(err.message || "Authentication failed", { id: "zerodha-auth" });
          }
        } else {
          toast.error("Authentication failed or was cancelled", { id: "zerodha-auth" });
        }
      }
    };
    window.addEventListener('message', messageListener);
  };

  const handleAddConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newConfig.apiKey || !newConfig.apiSecret) {
      toast.error("API Key and Secret are required");
      return;
    }

    try {
      const docRef = await addDoc(collection(db, 'users', user.uid, 'brokerConfigs'), {
        ...newConfig,
        isActive: true,
        updatedAt: new Date().toISOString()
      });
      
      setConfigs([...configs, { id: docRef.id, ...newConfig, isActive: true, updatedAt: new Date().toISOString() }]);
      setShowAddForm(false);
      setNewConfig({ brokerName: 'zerodha', apiKey: '', apiSecret: '' });
      toast.success(`${newConfig.brokerName} connected securely!`);
    } catch (error) {
      console.error("Error adding config:", error);
      toast.error("Failed to save configuration");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'brokerConfigs', id));
      setConfigs(configs.filter(c => c.id !== id));
      toast.success("Broker disconnected");
    } catch (error) {
      console.error("Error deleting config:", error);
      toast.error("Failed to disconnect broker");
    }
  };

  const toggleActive = async (id: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(db, 'users', user.uid, 'brokerConfigs', id), {
        isActive: !currentStatus,
        updatedAt: new Date().toISOString()
      });
      setConfigs(configs.map(c => c.id === id ? { ...c, isActive: !currentStatus } : c));
    } catch (error) {
      console.error("Error updating config:", error);
      toast.error("Failed to update status");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-zinc-900/95 backdrop-blur border-b border-zinc-800 p-6 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            {user.photoURL ? (
              <img 
                src={user.photoURL} 
                alt="Profile" 
                className="w-10 h-10 rounded-full border border-zinc-700"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold">
                {(user.displayName || user.email || 'U')[0].toUpperCase()}
              </div>
            )}
            <div>
              <h2 className="text-xl font-bold text-zinc-100">{user.displayName || 'Settings'}</h2>
              <p className="text-sm text-zinc-400">{user.email}</p>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-[11px] text-zinc-500 font-mono">ID: {user.uid}</p>
                <button
                  onClick={() => { navigator.clipboard.writeText(user.uid); toast.success('User ID copied! Paste it as OWNER_USER_ID in your .env file.'); }}
                  className="text-[10px] px-1.5 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded border border-zinc-700 transition-colors"
                >
                  Copy
                </button>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-full transition-colors text-zinc-400">
            <XCircle className="w-6 h-6" />
          </button>
        </div>

        <div className="flex border-b border-zinc-800">
          <button
            onClick={() => setActiveTab('brokers')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'brokers' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Brokers
          </button>
          <button
            onClick={() => setActiveTab('apikeys')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'apikeys' ? 'text-amber-400 border-b-2 border-amber-400' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            🔑 API Keys
          </button>
          <button
            onClick={() => setActiveTab('notifications')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'notifications' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Alerts
          </button>
          <button
            onClick={() => setActiveTab('preferences')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'preferences' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Style
          </button>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="text-center py-8 text-zinc-400 animate-pulse">Loading settings...</div>
          ) : activeTab === 'brokers' ? (
            <div className="space-y-6">
              {configs.length === 0 && !showAddForm ? (
                <div className="text-center py-12 border-2 border-dashed border-zinc-800 rounded-xl">
                  <Key className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-zinc-300 mb-2">No Brokers Connected</h3>
                  <p className="text-zinc-500 mb-6 max-w-sm mx-auto">Connect your first broker API to allow Jarvis to execute trades on your behalf.</p>
                  <button 
                    onClick={() => setShowAddForm(true)}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
                  >
                    Connect Broker
                  </button>
                </div>
              ) : (
                <div className="grid gap-4">
                  {configs.map(config => {
                    const isZerodha = config.brokerName === 'zerodha';
                    const needsLogin = isZerodha && (!config.lastLogin || new Date(config.lastLogin).toDateString() !== new Date().toDateString());

                    return (
                      <div key={config.id} className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-4 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className={`w-3 h-3 rounded-full ${config.isActive ? (needsLogin ? 'bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]' : 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]') : 'bg-zinc-600'}`} />
                          <div>
                            <h4 className="font-medium text-zinc-200 capitalize">{config.brokerName}</h4>
                            <p className="text-xs text-zinc-500 font-mono">Key: {config.apiKey.substring(0, 8)}••••••••</p>
                            {isZerodha && (
                              <p className={`text-xs mt-1 ${needsLogin ? 'text-yellow-500' : 'text-green-400'}`}>
                                {needsLogin ? '⚠️ Daily Login Required' : '✓ Authenticated for today'}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {isZerodha && needsLogin && config.isActive && (
                            <button 
                              onClick={() => handleDailyLogin(config)}
                              className="text-sm px-4 py-1.5 rounded-md bg-yellow-500/20 text-yellow-500 border border-yellow-500/50 hover:bg-yellow-500/30 transition-colors font-medium"
                            >
                              Login Now
                            </button>
                          )}
                          {config.isActive && (
                            <button
                              onClick={() => testConnection(config.id)}
                              disabled={testingId === config.id}
                              className="text-sm px-3 py-1.5 rounded-md bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30 transition-colors font-medium disabled:opacity-50"
                            >
                              {testingId === config.id ? 'Testing...' : '🔌 Test'}
                            </button>
                          )}
                          <button 
                            onClick={() => toggleActive(config.id, config.isActive)}
                            className={`text-sm px-3 py-1.5 rounded-md border transition-colors ${config.isActive ? 'border-zinc-600 text-zinc-400 hover:bg-zinc-700' : 'border-green-500/30 text-green-400 hover:bg-green-500/10'}`}
                          >
                            {config.isActive ? 'Pause' : 'Activate'}
                          </button>
                          <button 
                            onClick={() => handleDelete(config.id)}
                            className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                            title="Disconnect"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {!showAddForm && configs.length > 0 && (
                    <button 
                      onClick={() => setShowAddForm(true)}
                      className="w-full py-4 border-2 border-dashed border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/30 rounded-xl text-zinc-400 hover:text-zinc-300 transition-all flex items-center justify-center gap-2"
                    >
                      <Plus className="w-5 h-5" />
                      Add Another Broker
                    </button>
                  )}
                </div>
              )}

              {showAddForm && (
                <form onSubmit={handleAddConfig} className="bg-zinc-800/30 border border-zinc-700 rounded-xl p-6 space-y-4">
                  <h3 className="text-lg font-medium text-zinc-200 mb-4 flex items-center gap-2">
                    <Key className="w-5 h-5 text-blue-400" />
                    New API Connection
                  </h3>
                  
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-1">Broker / Exchange</label>
                    <select 
                      value={newConfig.brokerName}
                      onChange={(e) => setNewConfig({...newConfig, brokerName: e.target.value})}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:border-blue-500"
                    >
                      {BROKERS.map(b => (
                        <option key={b.id} value={b.id}>{b.name} ({b.type === 'crypto' ? '24/7' : 'Market Hours'})</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-1">API Key</label>
                    <input 
                      type="text"
                      value={newConfig.apiKey}
                      onChange={(e) => setNewConfig({...newConfig, apiKey: e.target.value})}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:border-blue-500 font-mono text-sm"
                      placeholder="Enter API Key"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-1">API Secret</label>
                    <input 
                      type="password"
                      value={newConfig.apiSecret}
                      onChange={(e) => setNewConfig({...newConfig, apiSecret: e.target.value})}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:border-blue-500 font-mono text-sm"
                      placeholder="Enter API Secret"
                    />
                    <p className="text-xs text-zinc-500 mt-2">
                      Your keys are encrypted and stored securely in your private Firebase Vault. Jarvis will use these to execute trades on your behalf.
                    </p>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button 
                      type="button"
                      onClick={() => setShowAddForm(false)}
                      className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg font-medium transition-colors"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit"
                      className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      Save & Connect
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : activeTab === 'notifications' ? (
            <div className="space-y-6">
              <form onSubmit={saveNotificationConfig} className="bg-zinc-800/30 border border-zinc-700 rounded-xl p-6 space-y-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-blue-500/10 rounded-lg">
                    <Send className="w-6 h-6 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-zinc-200">Telegram Notifications</h3>
                    <p className="text-sm text-zinc-400">Get instant alerts when Jarvis executes trades</p>
                  </div>
                </div>

                <div className="bg-zinc-900/50 p-4 rounded-lg border border-zinc-800">
                  <h4 className="text-sm font-medium text-zinc-300 mb-2">How to connect:</h4>
                  <ol className="list-decimal list-inside text-sm text-zinc-400 space-y-1">
                    <li>Message <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">@userinfobot</a> on Telegram</li>
                    <li>Type <code>/start</code> to get your Chat ID</li>
                    <li>Paste the ID below</li>
                  </ol>
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Telegram Chat ID</label>
                  <input 
                    type="text"
                    value={notificationConfig.telegramChatId}
                    onChange={(e) => setNotificationConfig({...notificationConfig, telegramChatId: e.target.value})}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:border-blue-500 font-mono text-sm"
                    placeholder="e.g. 123456789"
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <input 
                    type="checkbox"
                    id="enableTelegram"
                    checked={notificationConfig.enabled}
                    onChange={(e) => setNotificationConfig({...notificationConfig, enabled: e.target.checked})}
                    className="w-5 h-5 rounded border-zinc-700 bg-zinc-900 text-blue-500 focus:ring-blue-500/50 focus:ring-offset-zinc-950"
                  />
                  <label htmlFor="enableTelegram" className="text-sm font-medium text-zinc-300">Enable Telegram Alerts</label>
                </div>

                <button 
                  type="submit"
                  className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-5 h-5" />
                  Save Notification Settings
                </button>
              </form>
            </div>
          ) : activeTab === 'apikeys' ? (
            <div className="space-y-6">
              {/* Status Overview */}
              <div className={`p-4 rounded-xl border text-center ${keyStatus.hasGemini ? 'border-green-500/30 bg-green-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
                <div className={`text-2xl mb-1 ${keyStatus.hasGemini ? 'text-green-400' : 'text-amber-400'}`}>{keyStatus.hasGemini ? '✓' : '⚠'}</div>
                <div className="text-sm font-medium text-zinc-300">{keyStatus.hasGemini ? 'Personal Gemini Key Active' : 'Using Server Default Key'}</div>
                <div className="text-[11px] text-zinc-500 mt-1">{keyStatus.hasGemini ? 'Your own API quota is being used' : 'Set your own key to use your personal quota'}</div>
              </div>

              <div className="bg-zinc-800/30 border border-zinc-700 rounded-xl p-6 space-y-5">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-amber-500/10 rounded-lg">
                    <Lock className="w-6 h-6 text-amber-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-zinc-200">Gemini AI Key</h3>
                    <p className="text-sm text-zinc-400">Powers all of Jarvis&apos;s reasoning, analysis, and conversation</p>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">API Key</label>
                  <input
                    type="password"
                    value={userKeys.geminiApiKey}
                    onChange={e => setUserKeys({...userKeys, geminiApiKey: e.target.value})}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2 text-zinc-200 focus:outline-none focus:border-amber-500 font-mono text-sm"
                    placeholder={keyStatus.hasGemini ? '••••••• (already set — leave blank to keep)' : 'AIzaSy...'}
                  />
                  <p className="text-[11px] text-zinc-500 mt-1">Get your key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">aistudio.google.com</a></p>
                </div>

                <button
                  onClick={saveUserKeys}
                  disabled={savingKeys || !userKeys.geminiApiKey}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-black rounded-lg font-bold transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  <ShieldCheck className="w-5 h-5" />
                  {savingKeys ? 'Saving...' : 'Save API Key'}
                </button>
              </div>

              <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 space-y-2">
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  <strong className="text-zinc-300">📌 Other Keys:</strong> Binance exchange keys are managed in the <strong className="text-blue-400">Brokers</strong> tab. Telegram notifications are in the <strong className="text-blue-400">Alerts</strong> tab.
                </p>
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  <strong className="text-zinc-300">🔒 Security:</strong> Your key is stored in your personal Firestore vault and never exposed to the frontend after saving.
                </p>
              </div>
            </div>
          ) : activeTab === 'preferences' ? (
            <div className="space-y-6">
              <div className="bg-zinc-800/30 border border-zinc-700 rounded-xl p-6 space-y-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-blue-500/10 rounded-lg">
                    <Brain className="w-6 h-6 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-zinc-200">Agent Personality</h3>
                    <p className="text-sm text-zinc-400">How should Jarvis communicate with you?</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {(['classic', 'sarcastic', 'scientific'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPersonality?.(p)}
                      className={`p-3 rounded-lg border text-sm font-medium capitalize transition-all ${
                        personality === p
                          ? 'bg-blue-500/20 border-blue-500 text-blue-400'
                          : 'bg-zinc-900/50 border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-zinc-800/30 border border-zinc-700 rounded-xl p-6 space-y-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-blue-500/10 rounded-lg">
                    <Palette className="w-6 h-6 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-zinc-200">Visual Style</h3>
                    <p className="text-sm text-zinc-400">Customize the appearance of the Jarvis Orb</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {(['hologram', 'liquid', 'ethereal'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setOrbVariant?.(v)}
                      className={`p-3 rounded-lg border text-sm font-medium capitalize transition-all ${
                        orbVariant === v
                          ? 'bg-blue-500/20 border-blue-500 text-blue-400'
                          : 'bg-zinc-900/50 border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300'
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
