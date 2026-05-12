import { useState, useEffect } from 'react';
import { signInWithPopup, signInWithRedirect, signInWithCredential, GoogleAuthProvider, onAuthStateChanged, User, getRedirectResult } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { BrainCircuit } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';

export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check for redirect result first
    getRedirectResult(auth).then(async (result) => {
      if (result?.user) {
        await handleUserLogin(result.user);
      }
    }).catch((err) => {
      console.error("Redirect login error:", err);
      setError(err.message);
    });

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        await handleUserLogin(user);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [onLogin]);

  const handleUserLogin = async (user: User) => {
    try {
      // Ensure user exists in Firestore
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);
      if (!userDoc.exists()) {
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          role: 'user',
          createdAt: new Date().toISOString()
        });
      }
      onLogin(user);
    } catch (err) {
      console.error("Failed to save user data:", err);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    const provider = new GoogleAuthProvider();
    try {
      if (Capacitor.isNativePlatform()) {
        const result = await FirebaseAuthentication.signInWithGoogle({ useCredentialManager: false });
        if (result.credential?.idToken) {
          const credential = GoogleAuthProvider.credential(result.credential.idToken);
          await signInWithCredential(auth, credential);
        } else {
          throw new Error('No ID token received from Google.');
        }
      } else {
        await signInWithPopup(auth, provider);
      }
    } catch (error: any) {
      console.error("Login failed:", error);
      // Fallback to redirect if popup fails due to network/cookie issues
      if (error.code === 'auth/network-request-failed' || error.code === 'auth/popup-blocked') {
        try {
          await signInWithRedirect(auth, provider);
        } catch (redirectError: any) {
          console.error("Redirect login failed:", redirectError);
          setError(redirectError.message);
        }
      } else {
        setError(error.message);
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center">
          <BrainCircuit className="w-12 h-12 text-blue-500 mb-4" />
          <p className="text-zinc-400">Initializing Command Center...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center relative overflow-hidden font-sans">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,150,255,0.05)_0%,transparent_70%)] pointer-events-none" />
      
      <div className="z-10 bg-zinc-900/50 p-8 rounded-2xl border border-zinc-800 backdrop-blur-xl flex flex-col items-center text-center max-w-md w-full">
        <div className="w-20 h-20 bg-blue-500/10 rounded-full flex items-center justify-center mb-6">
          <BrainCircuit className="w-10 h-10 text-blue-400" />
        </div>
        
        <h1 className="text-3xl font-bold text-zinc-100 mb-2">Jarvis Terminal</h1>
        <p className="text-zinc-400 mb-8">Secure access required for Sentry Mode and Trading Operations.</p>
        
        {error && (
          <div className="w-full bg-red-500/10 border border-red-500/50 text-red-400 p-3 rounded-xl mb-6 text-sm text-left">
            <p className="font-semibold mb-1">Login Error</p>
            <p>{error}</p>
          </div>
        )}

        <button
          onClick={handleGoogleLogin}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Authenticate with Google
        </button>
      </div>
    </div>
  );
}
