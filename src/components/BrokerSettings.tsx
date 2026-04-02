import React, { useState, useEffect } from 'react';
import { collection, query, getDocs, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { User } from 'firebase/auth';
import { Key, Plus, Trash2, CheckCircle2, XCircle, ShieldCheck } from 'lucide-react';
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

const BROKERS = [
  { id: 'zerodha', name: 'Zerodha (Kite Connect)', type: 'indian_equity' },
  { id: 'upstox', name: 'Upstox', type: 'indian_equity' },
  { id: 'binance', name: 'Binance', type: 'crypto' },
  { id: 'bybit', name: 'Bybit', type: 'crypto' },
  { id: 'paper', name: 'Paper Trading (Simulator)', type: 'simulator' }
];

export function BrokerSettings({ user, onClose }: { user: User, onClose: () => void }) {
  const [configs, setConfigs] = useState<BrokerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newConfig, setNewConfig] = useState({ brokerName: 'zerodha', apiKey: '', apiSecret: '' });

  useEffect(() => {
    fetchConfigs();
  }, [user]);

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
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <ShieldCheck className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-100">The Vault (API Keys)</h2>
              <p className="text-sm text-zinc-400">Securely connect Jarvis to your brokers</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-full transition-colors text-zinc-400">
            <XCircle className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="text-center py-8 text-zinc-400 animate-pulse">Decrypting vault...</div>
          ) : (
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
          )}
        </div>
      </div>
    </div>
  );
}
