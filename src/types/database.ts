export type UserRole = 'player' | 'admin';

export interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  is_active: boolean;
  created_at: string;
}

export interface MatchRow {
  id: string;
  match_date: string; // YYYY-MM-DD
  match_number: 1 | 2;
  start_time: string;
  created_at: string;
}

export interface RegistrationRow {
  id: string;
  match_date: string;
  user_id: string | null;
  registered_by: string | null;
  guest_first_name: string | null;
  guest_last_name: string | null;
  registered_at: string;
  queue_seq: number;
  profiles: {
    id: string;
    first_name: string;
    last_name: string;
  } | null;
  registrant: {
    id: string;
    first_name: string;
    last_name: string;
  } | null;
}

export interface QueuePlayer {
  registrationId: string;
  userId: string | null;
  registeredBy: string | null;
  registeredByName: string | null;
  fullName: string;
  position: number; // 1..8
  matchNumber: 1 | 2;
  registeredAt: string;
  isCurrentUser: boolean;
  isCompanionByMe: boolean;
  isGuestAccount: boolean;
}

export interface DaySchedule {
  date: string; // YYYY-MM-DD
  isPast: boolean;
  isToday: boolean;
  totalRegistered: number;
  match1Players: QueuePlayer[];
  match2Players: QueuePlayer[];
  currentUserMatch: 1 | 2 | null;
}

export interface RpcActionResponse {
  success: boolean;
  code?: string;
  message: string;
  assigned_match?: 1 | 2;
  position?: number;
}

export interface AdminUserRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  is_active: boolean;
  role: UserRole;
  email_confirmed: boolean;
  created_at: string;
}

export interface AuditLogRow {
  id: string;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  target_user_id: string | null;
  target_name: string | null;
  match_date: string | null;
  details: Record<string, unknown>;
  created_at: string;
}
