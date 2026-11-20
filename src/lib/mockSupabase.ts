import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js';
import { addDaysISO, getMadridTodayISO, getMondayOfWeekISO } from './dates';
import { isValidPhone, normalizePhone } from './phone';
import type {
  AdminUserRow,
  AuditLogRow,
  Profile,
  RegistrationRow,
  RpcActionResponse,
  UserRole,
} from '../types/database';

interface MockUserRecord {
  id: string;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone: string;
  is_active: boolean;
  role: UserRole;
  email_confirmed: boolean;
  created_at: string;
}

interface MockRegistrationRecord {
  id: string;
  match_date: string;
  user_id: string | null;
  registered_by: string | null;
  guest_first_name: string | null;
  guest_last_name: string | null;
  guest_phone: string | null;
  registered_at: string;
  queue_seq: number;
}

const SESSION_STORAGE_KEY = 'elforcon_mock_user_id';

function isWeekdayISO(isoDate: string): boolean {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const day = dt.getUTCDay();
  return day >= 1 && day <= 5;
}

function makeMockUser(record: MockUserRecord): User {
  return {
    id: record.id,
    app_metadata: {},
    user_metadata: {
      first_name: record.first_name,
      last_name: record.last_name,
      phone: record.phone,
    },
    aud: 'authenticated',
    confirmation_sent_at: record.created_at,
    email: record.email,
    created_at: record.created_at,
    role: 'authenticated',
    updated_at: record.created_at,
  };
}

function makeMockSession(record: MockUserRecord): Session {
  const user = makeMockUser(record);
  return {
    access_token: `mock-access-token-${record.id}`,
    refresh_token: `mock-refresh-token-${record.id}`,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user,
  };
}

export function createMockSupabaseClient(): SupabaseClient {
  const nowISO = new Date().toISOString();
  const todayISO = getMadridTodayISO();
  const mondayISO = getMondayOfWeekISO(todayISO);

  const users: MockUserRecord[] = [
    {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'admin@elforcon.es',
      password: 'password',
      first_name: 'Silvia',
      last_name: 'Suárez',
      phone: '600000001',
      is_active: true,
      role: 'admin',
      email_confirmed: true,
      created_at: nowISO,
    },
    {
      id: '00000000-0000-0000-0000-000000000002',
      email: 'jugador@elforcon.es',
      password: 'password',
      first_name: 'Carlos',
      last_name: 'García',
      phone: '600000002',
      is_active: true,
      role: 'player',
      email_confirmed: true,
      created_at: nowISO,
    },
    {
      id: '00000000-0000-0000-0000-000000000003',
      email: 'lucia@elforcon.es',
      password: 'password',
      first_name: 'Lucía',
      last_name: 'Fernández',
      phone: '600000003',
      is_active: true,
      role: 'player',
      email_confirmed: true,
      created_at: nowISO,
    },
    {
      id: '00000000-0000-0000-0000-000000000004',
      email: 'miguel@elforcon.es',
      password: 'password',
      first_name: 'Miguel',
      last_name: 'Rodríguez',
      phone: '600000004',
      is_active: true,
      role: 'player',
      email_confirmed: true,
      created_at: nowISO,
    },
    {
      id: '00000000-0000-0000-0000-000000000005',
      email: 'ana@elforcon.es',
      password: 'password',
      first_name: 'Ana',
      last_name: 'Martínez',
      phone: '600000005',
      is_active: true,
      role: 'player',
      email_confirmed: true,
      created_at: nowISO,
    },
    {
      id: '00000000-0000-0000-0000-000000000006',
      email: 'javier@elforcon.es',
      password: 'password',
      first_name: 'Javier',
      last_name: 'López',
      phone: '600000006',
      is_active: true,
      role: 'player',
      email_confirmed: true,
      created_at: nowISO,
    },
    {
      id: '00000000-0000-0000-0000-000000000007',
      email: 'sofia@elforcon.es',
      password: 'password',
      first_name: 'Sofía',
      last_name: 'Sánchez',
      phone: '600000007',
      is_active: true,
      role: 'player',
      email_confirmed: true,
      created_at: nowISO,
    },
  ];

  let nextSeq = 1;
  const registrations: MockRegistrationRecord[] = [];
  const auditLogs: AuditLogRow[] = [];

  const seedDay = (offset: number, userIds: string[]) => {
    const date = addDaysISO(mondayISO, offset);
    userIds.forEach((uid, idx) => {
      registrations.push({
        id: `reg-seed-${offset}-${idx + 1}`,
        match_date: date,
        user_id: uid,
        registered_by: uid,
        guest_first_name: null,
        guest_last_name: null,
        guest_phone: null,
        registered_at: new Date(Date.now() - (100 - idx) * 60000).toISOString(),
        queue_seq: nextSeq++,
      });
    });
  };

  // Seed sample week data so Match 1 & Match 2 queue behavior is visible immediately
  seedDay(0, [users[1].id, users[2].id, users[3].id]);
  seedDay(1, [users[1].id, users[2].id, users[3].id, users[4].id, users[5].id]);
  seedDay(2, [users[2].id, users[4].id]);
  seedDay(4, [users[1].id, users[2].id, users[3].id, users[4].id]);

  let currentUserId: string | null = null;
  try {
    const savedId = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (savedId && users.some((u) => u.id === savedId)) {
      currentUserId = savedId;
    }
  } catch {
    // Ignore storage access issues
  }

  const authListeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();
  const realtimeListeners = new Set<() => void>();

  const getCurrentUserRecord = (): MockUserRecord | null =>
    users.find((u) => u.id === currentUserId) ?? null;

  const persistUserId = (id: string | null) => {
    currentUserId = id;
    try {
      if (id) {
        window.localStorage.setItem(SESSION_STORAGE_KEY, id);
      } else {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch {
      // Ignore storage access issues
    }
  };

  const notifyAuth = (event: AuthChangeEvent) => {
    const rec = getCurrentUserRecord();
    const session = rec ? makeMockSession(rec) : null;
    for (const cb of authListeners) {
      cb(event, session);
    }
  };

  const notifyRealtime = () => {
    for (const cb of realtimeListeners) {
      cb();
    }
  };

  const getSortedDayRegs = (matchDate: string) =>
    registrations
      .filter((r) => r.match_date === matchDate)
      .sort((a, b) => {
        if (a.registered_at !== b.registered_at) {
          return a.registered_at.localeCompare(b.registered_at);
        }
        return a.queue_seq - b.queue_seq;
      });

  const addAuditLog = (
    action: string,
    actor: MockUserRecord | null,
    targetName: string | null,
    targetUserId: string | null,
    matchDate: string | null,
    details: Record<string, unknown> = {}
  ) => {
    auditLogs.unshift({
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      action,
      actor_id: actor?.id ?? null,
      actor_name: actor ? `${actor.first_name} ${actor.last_name}`.trim() : null,
      target_user_id: targetUserId,
      target_name: targetName,
      match_date: matchDate,
      details,
      created_at: new Date().toISOString(),
    });
  };

  const client = {
    auth: {
      async getSession() {
        const rec = getCurrentUserRecord();
        return {
          data: { session: rec ? makeMockSession(rec) : null },
          error: null,
        };
      },
      onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void) {
        authListeners.add(callback);
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                authListeners.delete(callback);
              },
            },
          },
        };
      },
      async signInWithPassword({ email, password }: { email: string; password: string }) {
        const cleanEmail = email.trim().toLowerCase();
        const found = users.find((u) => u.email.toLowerCase() === cleanEmail);
        if (!found || (!password && found.password)) {
          return {
            data: { user: null, session: null },
            error: { message: 'Invalid login credentials' },
          };
        }
        persistUserId(found.id);
        notifyAuth('SIGNED_IN');
        const session = makeMockSession(found);
        return { data: { user: session.user, session }, error: null };
      },
      async signUp({
        email,
        password,
        options,
      }: {
        email: string;
        password: string;
        options?: { data?: { first_name?: string; last_name?: string; phone?: string } };
      }) {
        const cleanEmail = email.trim().toLowerCase();
        if (users.some((u) => u.email.toLowerCase() === cleanEmail)) {
          return {
            data: { user: null, session: null },
            error: { message: 'User already registered' },
          };
        }
        const rawPhone = options?.data?.phone ?? '';
        const cleanPhone = normalizePhone(rawPhone);
        if (!isValidPhone(cleanPhone)) {
          return {
            data: { user: null, session: null },
            error: { message: 'Invalid phone number' },
          };
        }
        if (users.some((u) => normalizePhone(u.phone) === cleanPhone)) {
          return {
            data: { user: null, session: null },
            error: { message: 'Phone already registered' },
          };
        }

        const firstName = options?.data?.first_name?.trim() || 'Jugador';
        const lastName = options?.data?.last_name?.trim() || 'El Forcón';
        const newRecord: MockUserRecord = {
          id: `mock-user-${Date.now()}`,
          email: cleanEmail,
          password,
          first_name: firstName,
          last_name: lastName,
          phone: cleanPhone,
          is_active: true,
          role: cleanEmail === 'admin@elforcon.es' ? 'admin' : 'player',
          email_confirmed: true,
          created_at: new Date().toISOString(),
        };
        users.push(newRecord);

        // Vincular automáticamente cualquier inscripción de acompañante previa con este teléfono
        for (const reg of registrations) {
          if (reg.user_id === null && reg.guest_phone && normalizePhone(reg.guest_phone) === cleanPhone) {
            const alreadyInDay = registrations.some(
              (other) => other.match_date === reg.match_date && other.user_id === newRecord.id
            );
            if (!alreadyInDay) {
              reg.user_id = newRecord.id;
              reg.guest_first_name = null;
              reg.guest_last_name = null;
              reg.guest_phone = null;
            }
          }
        }

        persistUserId(newRecord.id);
        notifyAuth('SIGNED_IN');
        const session = makeMockSession(newRecord);
        return { data: { user: session.user, session }, error: null };
      },
      async resetPasswordForEmail(_email: string) {
        return { data: {}, error: null };
      },
      async updateUser({ password }: { password?: string }) {
        const rec = getCurrentUserRecord();
        if (!rec) {
          return { data: { user: null }, error: { message: 'Not authenticated' } };
        }
        if (password) {
          rec.password = password;
        }
        return { data: { user: makeMockUser(rec) }, error: null };
      },
      async signOut() {
        persistUserId(null);
        notifyAuth('SIGNED_OUT');
        return { error: null };
      },
    },

    from(table: string) {
      const filters: Array<{ op: 'eq' | 'gte' | 'lte'; col: string; val: unknown }> = [];
      const orders: Array<{ col: string; ascending: boolean }> = [];

      const executeQuery = async (): Promise<{ data: unknown; error: null }> => {
        if (table === 'profiles') {
          const idFilter = filters.find((f) => f.op === 'eq' && f.col === 'id');
          const found = users.find((u) => u.id === idFilter?.val);
          if (!found) return { data: [], error: null };
          const profile: Profile = {
            id: found.id,
            first_name: found.first_name,
            last_name: found.last_name,
            phone: found.phone,
            is_active: found.is_active,
            created_at: found.created_at,
          };
          return { data: [profile], error: null };
        }

        if (table === 'user_roles') {
          const idFilter = filters.find((f) => f.op === 'eq' && f.col === 'user_id');
          const found = users.find((u) => u.id === idFilter?.val);
          if (!found) return { data: [], error: null };
          return { data: [{ role: found.role }], error: null };
        }

        if (table === 'registrations') {
          let rows = registrations.slice();
          for (const f of filters) {
            if (f.op === 'gte' && f.col === 'match_date') {
              rows = rows.filter((r) => r.match_date >= String(f.val));
            } else if (f.op === 'lte' && f.col === 'match_date') {
              rows = rows.filter((r) => r.match_date <= String(f.val));
            } else if (f.op === 'eq' && f.col === 'match_date') {
              rows = rows.filter((r) => r.match_date === String(f.val));
            }
          }
          rows.sort((a, b) => {
            if (a.registered_at !== b.registered_at) {
              return a.registered_at.localeCompare(b.registered_at);
            }
            return a.queue_seq - b.queue_seq;
          });
          const mapped: RegistrationRow[] = rows.map((r) => {
            const u = r.user_id ? users.find((user) => user.id === r.user_id) : undefined;
            const regBy = r.registered_by
              ? users.find((user) => user.id === r.registered_by)
              : undefined;
            return {
              id: r.id,
              match_date: r.match_date,
              user_id: r.user_id,
              registered_by: r.registered_by,
              guest_first_name: r.guest_first_name,
              guest_last_name: r.guest_last_name,
              registered_at: r.registered_at,
              queue_seq: r.queue_seq,
              profiles: u
                ? {
                    id: u.id,
                    first_name: u.first_name,
                    last_name: u.last_name,
                  }
                : null,
              registrant: regBy
                ? {
                    id: regBy.id,
                    first_name: regBy.first_name,
                    last_name: regBy.last_name,
                  }
                : null,
            };
          });
          return { data: mapped, error: null };
        }

        if (table === 'daily_queue_view') {
          const userFilter = filters.find((f) => f.op === 'eq' && f.col === 'user_id');
          const regByFilter = filters.find((f) => f.op === 'eq' && f.col === 'registered_by');
          const gteFilter = filters.find((f) => f.op === 'gte' && f.col === 'match_date');
          const lteFilter = filters.find((f) => f.op === 'lte' && f.col === 'match_date');
          const dates = Array.from(new Set(registrations.map((r) => r.match_date))).sort();
          const result: Array<{
            id: string;
            match_date: string;
            user_id: string | null;
            registered_by: string | null;
            registered_at: string;
            queue_seq: number;
            first_name: string;
            last_name: string;
            registrant_first_name: string | null;
            registrant_last_name: string | null;
            match_number: 1 | 2;
            queue_position: number;
          }> = [];

          for (const d of dates) {
            if (gteFilter && d < String(gteFilter.val)) continue;
            if (lteFilter && d > String(lteFilter.val)) continue;
            const sorted = getSortedDayRegs(d);
            sorted.forEach((reg, idx) => {
              if (userFilter && reg.user_id !== userFilter.val) return;
              if (regByFilter && reg.registered_by !== regByFilter.val) return;

              const u = reg.user_id ? users.find((usr) => usr.id === reg.user_id) : undefined;
              const regBy = reg.registered_by
                ? users.find((usr) => usr.id === reg.registered_by)
                : undefined;

              const pos = idx + 1;
              result.push({
                id: reg.id,
                match_date: d,
                user_id: reg.user_id,
                registered_by: reg.registered_by,
                registered_at: reg.registered_at,
                queue_seq: reg.queue_seq,
                first_name: u?.first_name ?? reg.guest_first_name ?? 'Jugador',
                last_name: u?.last_name ?? reg.guest_last_name ?? '',
                registrant_first_name: regBy?.first_name ?? null,
                registrant_last_name: regBy?.last_name ?? null,
                match_number: pos <= 4 ? 1 : 2,
                queue_position: pos,
              });
            });
          }

          if (orders.length > 0) {
            result.sort((a, b) => {
              if (a.match_date !== b.match_date) {
                return a.match_date.localeCompare(b.match_date);
              }
              return a.queue_position - b.queue_position;
            });
          }

          return { data: result, error: null };
        }

        return { data: [], error: null };
      };

      const builder = {
        select(_columns?: string) {
          return builder;
        },
        eq(col: string, val: unknown) {
          filters.push({ op: 'eq', col, val });
          return builder;
        },
        gte(col: string, val: unknown) {
          filters.push({ op: 'gte', col, val });
          return builder;
        },
        lte(col: string, val: unknown) {
          filters.push({ op: 'lte', col, val });
          return builder;
        },
        order(col: string, opts?: { ascending?: boolean }) {
          orders.push({ col, ascending: opts?.ascending ?? true });
          return builder;
        },
        async maybeSingle() {
          const res = await executeQuery();
          const list = Array.isArray(res.data) ? res.data : [];
          return { data: list[0] ?? null, error: null };
        },
        then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
          onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
        ) {
          return executeQuery().then(onfulfilled, onrejected);
        },
      };

      return builder;
    },

    async rpc(fnName: string, params: Record<string, unknown> = {}) {
      const currentUser = getCurrentUserRecord();

      if (fnName === 'ensure_week_matches') {
        return { data: [], error: null };
      }

      if (fnName === 'register_for_match') {
        if (!currentUser) {
          return {
            data: {
              success: false,
              code: 'UNAUTHENTICATED',
              message: 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }
        if (!currentUser.is_active) {
          return {
            data: {
              success: false,
              code: 'INACTIVE_USER',
              message: 'Tu cuenta está desactivada. Contacta con el administrador.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }
        const matchDate = String(params.p_match_date);
        const expectedMatch = params.p_expected_match_number as 1 | 2 | undefined;

        if (!isWeekdayISO(matchDate)) {
          return {
            data: {
              success: false,
              code: 'WEEKEND',
              message: 'Solo se celebran partidos de lunes a viernes.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }
        if (matchDate < getMadridTodayISO()) {
          return {
            data: {
              success: false,
              code: 'PAST_DATE',
              message: 'No es posible apuntarse a partidos de fechas pasadas.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }

        const dayRegs = getSortedDayRegs(matchDate);
        if (dayRegs.some((r) => r.user_id === currentUser.id)) {
          return {
            data: {
              success: false,
              code: 'ALREADY_REGISTERED',
              message: 'Ya estás inscrito en un partido de este día.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }
        if (dayRegs.length >= 8) {
          return {
            data: {
              success: false,
              code: 'DAY_FULL',
              message: 'No quedan plazas disponibles.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }
        if (expectedMatch === 2 && dayRegs.length < 4) {
          return {
            data: {
              success: false,
              code: 'MATCH_2_CLOSED',
              message: 'El Partido 2 todavía no está abierto.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }
        if (expectedMatch === 1 && dayRegs.length >= 4) {
          return {
            data: {
              success: false,
              code: 'MATCH_1_FULL',
              message: 'El Partido 1 está completo.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }

        registrations.push({
          id: `reg-${Date.now()}-${nextSeq}`,
          match_date: matchDate,
          user_id: currentUser.id,
          registered_by: currentUser.id,
          guest_first_name: null,
          guest_last_name: null,
          guest_phone: null,
          registered_at: new Date().toISOString(),
          queue_seq: nextSeq++,
        });
        const newPos = dayRegs.length + 1;
        const assignedMatch: 1 | 2 = newPos <= 4 ? 1 : 2;
        addAuditLog(
          'PLAYER_REGISTER',
          currentUser,
          `${currentUser.first_name} ${currentUser.last_name}`.trim(),
          currentUser.id,
          matchDate,
          { assigned_match: assignedMatch, position: newPos }
        );
        notifyRealtime();

        return {
          data: {
            success: true,
            code: 'REGISTERED',
            message: 'Te has apuntado correctamente al partido.',
            assigned_match: assignedMatch,
            position: newPos,
          } satisfies RpcActionResponse,
          error: null,
        };
      }

      if (fnName === 'register_companion') {
        if (!currentUser) {
          return {
            data: {
              success: false,
              code: 'UNAUTHENTICATED',
              message: 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }
        if (!currentUser.is_active) {
          return {
            data: {
              success: false,
              code: 'INACTIVE_USER',
              message: 'Tu cuenta está desactivada. Contacta con el administrador.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }

        const matchDate = String(params.p_match_date);
        const expectedMatch = params.p_expected_match_number as 1 | 2 | undefined;
        const firstName = String(params.p_first_name ?? '').trim();
        const lastName = String(params.p_last_name ?? '').trim();
        const cleanPhone = normalizePhone(String(params.p_phone ?? ''));

        if (!firstName || !lastName) {
          return {
            data: {
              success: false,
              code: 'INVALID_NAME',
              message: 'Introduce el nombre y apellidos del acompañante.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }
        if (!isValidPhone(cleanPhone)) {
          return {
            data: {
              success: false,
              code: 'INVALID_PHONE',
              message: 'Introduce un número de teléfono válido (al menos 9 dígitos).',
            } satisfies RpcActionResponse,
            error: null,
          };
        }
        if (!isWeekdayISO(matchDate)) {
          return {
            data: {
              success: false,
              code: 'WEEKEND',
              message: 'Solo se celebran partidos de lunes a viernes.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }
        if (matchDate < getMadridTodayISO()) {
          return {
            data: {
              success: false,
              code: 'PAST_DATE',
              message: 'No es posible apuntar a partidos de fechas pasadas.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }

        const matchedAccount = users.find((u) => normalizePhone(u.phone) === cleanPhone);
        if (matchedAccount && matchedAccount.id === currentUser.id) {
          return {
            data: {
              success: false,
              code: 'SELF_AS_COMPANION',
              message: 'Para apuntarte a ti mismo usa el botón APUNTARME.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }
        if (matchedAccount && !matchedAccount.is_active) {
          return {
            data: {
              success: false,
              code: 'TARGET_INACTIVE',
              message: 'La cuenta asociada a ese teléfono está desactivada.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }

        const dayRegs = getSortedDayRegs(matchDate);
        if (
          matchedAccount &&
          dayRegs.some((r) => r.user_id === matchedAccount.id)
        ) {
          return {
            data: {
              success: false,
              code: 'ALREADY_REGISTERED',
              message: `${matchedAccount.first_name} ${matchedAccount.last_name} ya está inscrito en un partido de este día.`,
            } satisfies RpcActionResponse,
            error: null,
          };
        }
        if (
          !matchedAccount &&
          dayRegs.some((r) => r.guest_phone && normalizePhone(r.guest_phone) === cleanPhone)
        ) {
          return {
            data: {
              success: false,
              code: 'ALREADY_REGISTERED',
              message: 'Ya existe una inscripción para ese número de teléfono este día.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }

        if (dayRegs.length >= 8) {
          return {
            data: {
              success: false,
              code: 'DAY_FULL',
              message: 'No quedan plazas disponibles.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }
        if (expectedMatch === 2 && dayRegs.length < 4) {
          return {
            data: {
              success: false,
              code: 'MATCH_2_CLOSED',
              message: 'El Partido 2 todavía no está abierto.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }
        if (expectedMatch === 1 && dayRegs.length >= 4) {
          return {
            data: {
              success: false,
              code: 'MATCH_1_FULL',
              message: 'El Partido 1 está completo.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }

        const displayName = matchedAccount
          ? `${matchedAccount.first_name} ${matchedAccount.last_name}`.trim()
          : `${firstName} ${lastName}`.trim();

        registrations.push({
          id: `reg-${Date.now()}-${nextSeq}`,
          match_date: matchDate,
          user_id: matchedAccount ? matchedAccount.id : null,
          registered_by: currentUser.id,
          guest_first_name: matchedAccount ? null : firstName,
          guest_last_name: matchedAccount ? null : lastName,
          guest_phone: matchedAccount ? null : cleanPhone,
          registered_at: new Date().toISOString(),
          queue_seq: nextSeq++,
        });

        const newPos = dayRegs.length + 1;
        const assignedMatch: 1 | 2 = newPos <= 4 ? 1 : 2;

        addAuditLog(
          'COMPANION_REGISTER',
          currentUser,
          displayName,
          matchedAccount?.id ?? null,
          matchDate,
          {
            assigned_match: assignedMatch,
            position: newPos,
            linked_account: Boolean(matchedAccount),
          }
        );
        notifyRealtime();

        return {
          data: {
            success: true,
            code: 'REGISTERED',
            message: matchedAccount
              ? `Has apuntado a ${displayName} al Partido ${assignedMatch} (verá la inscripción en su cuenta).`
              : `Has apuntado a ${displayName} al Partido ${assignedMatch}.`,
            assigned_match: assignedMatch,
            position: newPos,
          } satisfies RpcActionResponse,
          error: null,
        };
      }

      if (fnName === 'cancel_registration') {
        if (!currentUser) {
          return {
            data: {
              success: false,
              code: 'UNAUTHENTICATED',
              message: 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }
        const matchDate = String(params.p_match_date);
        const registrationId = params.p_registration_id ? String(params.p_registration_id) : null;

        if (matchDate < getMadridTodayISO()) {
          return {
            data: {
              success: false,
              code: 'PAST_DATE',
              message: 'No se pueden modificar inscripciones de fechas pasadas.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }

        const idx = registrations.findIndex((r) => {
          if (registrationId) {
            return (
              r.id === registrationId &&
              r.match_date === matchDate &&
              (r.user_id === currentUser.id || r.registered_by === currentUser.id)
            );
          }
          return r.match_date === matchDate && r.user_id === currentUser.id;
        });

        if (idx === -1) {
          return {
            data: {
              success: false,
              code: 'NOT_REGISTERED',
              message: 'No se ha encontrado la inscripción o no tienes permiso para cancelarla.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }

        const targetReg = registrations[idx];
        const targetUser = targetReg.user_id
          ? users.find((u) => u.id === targetReg.user_id)
          : undefined;
        const targetName = targetUser
          ? `${targetUser.first_name} ${targetUser.last_name}`.trim()
          : `${targetReg.guest_first_name ?? ''} ${targetReg.guest_last_name ?? ''}`.trim();

        const isSelf = targetReg.user_id === currentUser.id;
        registrations.splice(idx, 1);

        addAuditLog(
          isSelf ? 'PLAYER_CANCEL' : 'COMPANION_CANCEL',
          currentUser,
          targetName || null,
          targetReg.user_id,
          matchDate
        );
        notifyRealtime();

        return {
          data: {
            success: true,
            code: 'CANCELLED',
            message: isSelf
              ? 'Te has desapuntado correctamente.'
              : `Has dado de baja a ${targetName} correctamente.`,
          } satisfies RpcActionResponse,
          error: null,
        };
      }

      if (fnName === 'admin_get_users') {
        if (!currentUser || currentUser.role !== 'admin') {
          return { data: null, error: { message: 'Acceso denegado' } };
        }
        const rows: AdminUserRow[] = [...users]
          .sort((a, b) =>
            `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)
          )
          .map((u) => ({
            id: u.id,
            first_name: u.first_name,
            last_name: u.last_name,
            email: u.email,
            phone: u.phone,
            is_active: u.is_active,
            role: u.role,
            email_confirmed: u.email_confirmed,
            created_at: u.created_at,
          }));
        return { data: rows, error: null };
      }

      if (fnName === 'admin_get_audit_logs') {
        if (!currentUser || currentUser.role !== 'admin') {
          return { data: null, error: { message: 'Acceso denegado' } };
        }
        const limit = Number(params.p_limit ?? 100);
        return { data: auditLogs.slice(0, limit), error: null };
      }

      if (fnName === 'admin_add_registration') {
        if (!currentUser || currentUser.role !== 'admin') {
          return {
            data: { success: false, message: 'Acceso denegado.' } satisfies RpcActionResponse,
            error: null,
          };
        }
        const matchDate = String(params.p_match_date);
        const targetId = String(params.p_target_user_id);
        const target = users.find((u) => u.id === targetId);
        if (!target) {
          return {
            data: { success: false, message: 'Jugador no encontrado.' } satisfies RpcActionResponse,
            error: null,
          };
        }
        if (!target.is_active) {
          return {
            data: {
              success: false,
              message: 'El jugador tiene la cuenta desactivada.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }
        const dayRegs = getSortedDayRegs(matchDate);
        if (dayRegs.some((r) => r.user_id === targetId)) {
          return {
            data: {
              success: false,
              message: 'Este jugador ya está inscrito ese día.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }
        if (dayRegs.length >= 8) {
          return {
            data: {
              success: false,
              message: 'El día ya tiene el máximo de 8 jugadores.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }

        registrations.push({
          id: `reg-${Date.now()}-${nextSeq}`,
          match_date: matchDate,
          user_id: targetId,
          registered_by: currentUser.id,
          guest_first_name: null,
          guest_last_name: null,
          guest_phone: null,
          registered_at: new Date().toISOString(),
          queue_seq: nextSeq++,
        });
        const newPos = dayRegs.length + 1;
        const assignedMatch: 1 | 2 = newPos <= 4 ? 1 : 2;
        addAuditLog(
          'ADMIN_ADD_PLAYER',
          currentUser,
          `${target.first_name} ${target.last_name}`.trim(),
          target.id,
          matchDate,
          { assigned_match: assignedMatch, position: newPos }
        );
        notifyRealtime();

        return {
          data: {
            success: true,
            message: `Jugador ${target.first_name} ${target.last_name} añadido al Partido ${assignedMatch}.`,
          } satisfies RpcActionResponse,
          error: null,
        };
      }

      if (fnName === 'admin_remove_registration') {
        if (!currentUser || currentUser.role !== 'admin') {
          return {
            data: { success: false, message: 'Acceso denegado.' } satisfies RpcActionResponse,
            error: null,
          };
        }
        const matchDate = String(params.p_match_date);
        const targetUserId = params.p_target_user_id ? String(params.p_target_user_id) : null;
        const registrationId = params.p_registration_id ? String(params.p_registration_id) : null;

        const idx = registrations.findIndex((r) => {
          if (registrationId) return r.id === registrationId && r.match_date === matchDate;
          return r.match_date === matchDate && r.user_id === targetUserId;
        });

        if (idx === -1) {
          return {
            data: { success: false, message: 'La inscripción no existe.' } satisfies RpcActionResponse,
            error: null,
          };
        }
        const removed = registrations[idx];
        const target = removed.user_id
          ? users.find((u) => u.id === removed.user_id) ?? null
          : null;
        const targetName = target
          ? `${target.first_name} ${target.last_name}`.trim()
          : `${removed.guest_first_name ?? ''} ${removed.guest_last_name ?? ''}`.trim() || 'el jugador';

        registrations.splice(idx, 1);
        addAuditLog('ADMIN_REMOVE_PLAYER', currentUser, targetName, removed.user_id, matchDate);
        notifyRealtime();

        return {
          data: {
            success: true,
            message: `Se ha eliminado a ${targetName} y se ha reorganizado la cola.`,
          } satisfies RpcActionResponse,
          error: null,
        };
      }

      if (fnName === 'admin_set_user_active') {
        if (!currentUser || currentUser.role !== 'admin') {
          return {
            data: { success: false, message: 'Acceso denegado.' } satisfies RpcActionResponse,
            error: null,
          };
        }
        const targetId = String(params.p_target_user_id);
        const isActive = Boolean(params.p_is_active);
        if (currentUser.id === targetId && !isActive) {
          return {
            data: {
              success: false,
              message: 'No puedes desactivar tu propia cuenta de administrador.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }
        const target = users.find((u) => u.id === targetId);
        if (!target) {
          return {
            data: { success: false, message: 'Usuario no encontrado.' } satisfies RpcActionResponse,
            error: null,
          };
        }
        target.is_active = isActive;
        if (!isActive) {
          const today = getMadridTodayISO();
          for (let i = registrations.length - 1; i >= 0; i--) {
            if (registrations[i].user_id === targetId && registrations[i].match_date >= today) {
              registrations.splice(i, 1);
            }
          }
        }
        addAuditLog(
          isActive ? 'ADMIN_ACTIVATE_USER' : 'ADMIN_DEACTIVATE_USER',
          currentUser,
          `${target.first_name} ${target.last_name}`.trim(),
          target.id,
          null,
          { is_active: isActive }
        );
        notifyRealtime();

        return {
          data: {
            success: true,
            message: isActive
              ? 'Cuenta reactivada correctamente.'
              : 'Cuenta desactivada y plazas futuras liberadas.',
          } satisfies RpcActionResponse,
          error: null,
        };
      }

      if (fnName === 'admin_delete_user') {
        if (!currentUser || currentUser.role !== 'admin') {
          return {
            data: { success: false, message: 'Acceso denegado.' } satisfies RpcActionResponse,
            error: null,
          };
        }
        const targetId = String(params.p_target_user_id);
        if (currentUser.id === targetId) {
          return {
            data: {
              success: false,
              message: 'No puedes eliminar tu propia cuenta.',
            } satisfies RpcActionResponse,
            error: null,
          };
        }
        const userIdx = users.findIndex((u) => u.id === targetId);
        if (userIdx === -1) {
          return {
            data: { success: false, message: 'Usuario no encontrado.' } satisfies RpcActionResponse,
            error: null,
          };
        }
        const target = users[userIdx];
        for (let i = registrations.length - 1; i >= 0; i--) {
          if (registrations[i].user_id === targetId) {
            registrations.splice(i, 1);
          }
        }
        users.splice(userIdx, 1);
        addAuditLog(
          'ADMIN_DELETE_USER',
          currentUser,
          `${target.first_name} ${target.last_name}`.trim(),
          target.id,
          null
        );
        notifyRealtime();

        return {
          data: {
            success: true,
            message: `Usuario ${target.first_name} ${target.last_name} eliminado correctamente.`,
          } satisfies RpcActionResponse,
          error: null,
        };
      }

      return { data: null, error: { message: `Unknown RPC: ${fnName}` } };
    },

    channel(_name: string) {
      const callbacks: Array<() => void> = [];
      const ch = {
        on(_event: string, _filter: unknown, cb: () => void) {
          callbacks.push(cb);
          realtimeListeners.add(cb);
          return ch;
        },
        subscribe() {
          return ch;
        },
        _callbacks: callbacks,
      };
      return ch;
    },

    async removeChannel(ch: { _callbacks?: Array<() => void> }) {
      if (ch?._callbacks) {
        for (const cb of ch._callbacks) {
          realtimeListeners.delete(cb);
        }
      }
      return 'ok';
    },
  };

  return client as unknown as SupabaseClient;
}
