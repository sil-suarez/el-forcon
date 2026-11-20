import { useEffect, useState, useCallback } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Profile, UserRole } from '../types/database';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: UserRole;
  loading: boolean;
  isPasswordRecovery: boolean;
  clearPasswordRecovery: () => void;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<UserRole>('player');
  const [loading, setLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  const loadUserDetails = useCallback(async (userId: string) => {
    const [{ data: profileData }, { data: roleData }] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, first_name, last_name, phone, is_active, created_at')
        .eq('id', userId)
        .maybeSingle(),
      supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle(),
    ]);

    setProfile((profileData as Profile | null) ?? null);
    setRole(roleData?.role === 'admin' ? 'admin' : 'player');
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user?.id) {
      await loadUserDetails(session.user.id);
    }
  }, [session?.user?.id, loadUserDetails]);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const {
          data: { session: initialSession },
        } = await supabase.auth.getSession();

        if (!mounted) return;
        setSession(initialSession);

        if (initialSession?.user?.id) {
          await loadUserDetails(initialSession.user.id);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;
      setSession(newSession);

      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
      }

      if (newSession?.user?.id) {
        // Evitar bloquear la callback de Supabase con await directo
        setTimeout(() => {
          if (mounted) {
            void loadUserDetails(newSession.user.id);
          }
        }, 0);
      } else {
        setProfile(null);
        setRole('player');
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadUserDetails]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setRole('player');
  }, []);

  const clearPasswordRecovery = useCallback(() => {
    setIsPasswordRecovery(false);
  }, []);

  return {
    session,
    user: session?.user ?? null,
    profile,
    role,
    loading,
    isPasswordRecovery,
    clearPasswordRecovery,
    refreshProfile,
    signOut,
  };
}
