import { useState, useEffect, useRef, MouseEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface ChatSession {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface ChatSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  currentSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
}

function groupSessionsByDate(sessions: ChatSession[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const last7Days = new Date(today.getTime() - 7 * 86400000);

  const groups: { label: string; sessions: ChatSession[] }[] = [
    { label: 'Today', sessions: [] },
    { label: 'Yesterday', sessions: [] },
    { label: 'Last 7 Days', sessions: [] },
    { label: 'Older', sessions: [] },
  ];

  for (const s of sessions) {
    const d = new Date(s.updatedAt);
    if (d >= today) groups[0].sessions.push(s);
    else if (d >= yesterday) groups[1].sessions.push(s);
    else if (d >= last7Days) groups[2].sessions.push(s);
    else groups[3].sessions.push(s);
  }

  return groups.filter(g => g.sessions.length > 0);
}

export default function ChatSidebar({ isOpen, onClose, userId, currentSessionId, onSelectSession, onNewChat }: ChatSidebarProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const editRef = useRef<HTMLInputElement>(null);

  // Fetch sessions when sidebar opens
  useEffect(() => {
    if (!isOpen || !userId) return;
    setLoading(true);
    fetch(`/api/sessions/${userId}`)
      .then(r => r.json())
      .then(data => {
        if (data.status === 'success') setSessions(data.sessions);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [isOpen, userId]);

  // Refresh sessions when currentSessionId changes (new session created)
  useEffect(() => {
    if (!userId || !currentSessionId) return;
    fetch(`/api/sessions/${userId}`)
      .then(r => r.json())
      .then(data => {
        if (data.status === 'success') setSessions(data.sessions);
      })
      .catch(console.error);
  }, [currentSessionId, userId]);

  const handleDelete = async (sessionId: string, e: MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this chat?')) return;
    try {
      await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
      setSessions(prev => prev.filter(s => s.id !== sessionId));
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  const handleRename = async (sessionId: string) => {
    if (!editTitle.trim()) { setEditingId(null); return; }
    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle.trim() })
      });
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: editTitle.trim() } : s));
    } catch (err) {
      console.error('Failed to rename session:', err);
    }
    setEditingId(null);
  };

  const startEdit = (session: ChatSession, e: MouseEvent) => {
    e.stopPropagation();
    setEditingId(session.id);
    setEditTitle(session.title);
    setTimeout(() => editRef.current?.focus(), 50);
  };

  const grouped = groupSessionsByDate(sessions);

  return (
    <>
      {/* Backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="chat-sidebar-backdrop"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      {/* Sidebar Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ x: -320 }}
            animate={{ x: 0 }}
            exit={{ x: -320 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="chat-sidebar"
          >
            {/* Header */}
            <div className="chat-sidebar-header">
              <h2>Chat History</h2>
              <button onClick={onClose} className="chat-sidebar-close">✕</button>
            </div>

            {/* New Chat Button */}
            <button className="chat-sidebar-new-btn" onClick={() => { onNewChat(); onClose(); }}>
              <span>+</span> New Chat
            </button>

            {/* Sessions List */}
            <div className="chat-sidebar-list">
              {loading ? (
                <div className="chat-sidebar-empty">Loading...</div>
              ) : sessions.length === 0 ? (
                <div className="chat-sidebar-empty">No conversations yet.<br/>Start talking to Jarvis!</div>
              ) : (
                grouped.map(group => (
                  <div key={group.label} className="chat-sidebar-group">
                    <div className="chat-sidebar-group-label">{group.label}</div>
                    {group.sessions.map(session => (
                      <div
                        key={session.id}
                        className={`chat-sidebar-item ${session.id === currentSessionId ? 'active' : ''}`}
                        onClick={() => { onSelectSession(session.id); onClose(); }}
                      >
                        {editingId === session.id ? (
                          <input
                            ref={editRef}
                            className="chat-sidebar-rename-input"
                            value={editTitle}
                            onChange={e => setEditTitle(e.target.value)}
                            onBlur={() => handleRename(session.id)}
                            onKeyDown={e => { if (e.key === 'Enter') handleRename(session.id); if (e.key === 'Escape') setEditingId(null); }}
                            onClick={e => e.stopPropagation()}
                          />
                        ) : (
                          <>
                            <span className="chat-sidebar-item-title">{session.title}</span>
                            <div className="chat-sidebar-item-actions">
                              <button onClick={(e) => startEdit(session, e)} title="Rename">✏️</button>
                              <button onClick={(e) => handleDelete(session.id, e)} title="Delete">🗑️</button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
