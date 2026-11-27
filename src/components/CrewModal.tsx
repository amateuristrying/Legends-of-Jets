import React, { useEffect, useState } from 'react';
import { CrewClient, type CrewLobby, type CrewProfile, type CrewRules } from '../engine/crew';
import { planes } from '../engine/world';

interface Props {
  crew: CrewClient;
  currentPlane: number;
  onChangePlane: (plane: number) => void;
  onActivateAudio: () => void;
  onClose: () => void;
}

export const CrewModal: React.FC<Props> = ({
  crew,
  currentPlane,
  onChangePlane,
  onActivateAudio,
  onClose,
}) => {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [profile, setProfile] = useState<CrewProfile | null>(null);
  const [lobby, setLobby] = useState<CrewLobby | null>(crew.lobby);
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [notice, setNotice] = useState<{ text: string; error: boolean }>({ text: '', error: false });
  const [busy, setBusy] = useState(false);
  const [rules, setRules] = useState<CrewRules>({
    seats: 2,
    mode: 'duel',
    seconds: 180,
    difficulty: 'veteran',
    map: 0,
    night: false,
  });
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [friendCode, setFriendCode] = useState('');

  const refresh = async () => {
    try {
      const ok = await crew.checkStatus();
      setAvailable(ok);
      if (!ok) return;
      const home = await crew.home();
      setProfile(home);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      if (e.status === 401) setProfile(null);
      else if (e.status === 503) setAvailable(false);
      else setNotice({ text: e.message || 'Crew unavailable.', error: true });
    }
  };

  useEffect(() => {
    const prevLobby = crew.onLobby;
    const prevStatus = crew.onStatus;
    crew.onLobby = (l) => {
      setLobby(l);
      prevLobby?.(l);
    };
    crew.onStatus = (text, error) => {
      setNotice({ text, error: Boolean(error) });
      prevStatus?.(text, error);
    };
    refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => {
      clearInterval(timer);
      crew.onLobby = prevLobby;
      crew.onStatus = prevStatus;
    };
  }, []);

  const runAction = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setNotice({ text: '', error: false });
    try {
      await fn();
    } catch (err: unknown) {
      setNotice({ text: (err as Error).message || 'Action failed.', error: true });
    } finally {
      setBusy(false);
    }
  };

  const handleAuth = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    runAction(async () => {
      const res = await crew.auth(tab, data);
      if (res.verify) {
        setTab('login');
        setNotice({ text: 'Check your inbox to verify your email, then sign in.', error: false });
        return;
      }
      setProfile(await crew.home());
    });
  };

  const friends = profile?.connections.filter((c) => c.status === 'accepted') ?? [];
  const invites = profile?.connections.filter((c) => c.status === 'pending') ?? [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" aria-label="Close dialog" onClick={onClose}>
          ×
        </button>

        {available === false ? (
          <>
            <span className="eyebrow">CREW MULTIPLAYER</span>
            <h2>Online Play</h2>
            <p>
              Open Legends of Jets on your Cloudflare Worker / online server to sign in with
              Supabase Auth and fly 1v1, 2v2, or Co-op vs Bots with friends. For offline dogfights
              right now, use the <strong>Skirmish</strong> mode from the hangar!
            </p>
          </>
        ) : available === null ? (
          <>
            <span className="eyebrow">CREW</span>
            <h2>Pilot Network</h2>
            <p>Checking connection…</p>
          </>
        ) : !profile ? (
          <>
            <span className="eyebrow">CREW</span>
            <h2>{tab === 'signup' ? 'Create Pilot Account' : 'Pilot Sign-In'}</h2>
            <p>Sign in to get a personal six-digit code and fly with your crew.</p>
            <div className="act-tabs">
              <button className={tab === 'login' ? 'active' : ''} onClick={() => setTab('login')}>
                Sign in
              </button>
              <button className={tab === 'signup' ? 'active' : ''} onClick={() => setTab('signup')}>
                Create account
              </button>
            </div>
            <form className="crew-form" onSubmit={handleAuth}>
              {tab === 'signup' && (
                <label>
                  Callsign <input name="name" maxLength={28} required />
                </label>
              )}
              <label>
                Email <input name="email" type="email" required />
              </label>
              <label>
                Password <input name="password" type="password" minLength={tab === 'signup' ? 8 : 1} required />
              </label>
              <button className="primary" type="submit" disabled={busy}>
                {tab === 'signup' ? 'Create account' : 'Sign in'}
              </button>
              <a
                style={{
                  color: '#bce5dc',
                  padding: 11,
                  border: '1px solid #647e8c',
                  textAlign: 'center',
                  textDecoration: 'none',
                }}
                href="/api/crew/auth/google"
              >
                Continue with Google
              </a>
            </form>
          </>
        ) : lobby ? (
          <>
            <span className="eyebrow">
              CREW LOBBY {crew.pingMs !== null ? `· PING ${crew.pingMs}ms` : ''}
            </span>
            <h2>{lobby.rules.mode === 'duel' ? 'Deathmatch' : 'Crew vs Bots'}</h2>
            <p>
              {lobby.rules.seats} Players · {lobby.rules.seconds / 60} min ·{' '}
              {lobby.rules.map === 0 ? 'Ember Canyon' : 'Frostline Reach'}
              {lobby.rules.mode === 'bots' ? ` · ${lobby.rules.difficulty}` : ''}
            </p>
            <div className="row">
              <label>In-Lobby Aircraft</label>
              <div className="segmented">
                {planes.slice(0, 3).map((p) => (
                  <button
                    key={p.id}
                    className={currentPlane === p.id ? 'active' : ''}
                    onClick={() => {
                      onChangePlane(p.id);
                      runAction(() => crew.switchPlaneInLobby(p.id));
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
            <ul className="crew-list">
              {lobby.members.map((m) => (
                <li key={m.id}>
                  <strong>
                    {m.name}
                    {m.id === lobby.host ? ' · Host' : ''} ({planes[m.plane]?.name ?? 'F-5'})
                  </strong>
                  <span style={{ color: m.online ? '#a7f0ba' : '#b7c9cf' }}>
                    {m.online ? 'Ready' : 'Waiting…'}
                  </span>
                </li>
              ))}
            </ul>
            <div className="btn-row">
              {lobby.host === profile.me.id && lobby.phase !== 'playing' && (
                <button
                  className="primary"
                  disabled={!lobby.members.every((m) => m.online)}
                  onClick={() => {
                    onActivateAudio();
                    crew.startMatch();
                  }}
                >
                  {lobby.phase === 'finished' ? 'Start Rematch' : 'Start Match'}
                </button>
              )}
              <button
                className="secondary"
                onClick={() => {
                  crew.disconnect();
                  setLobby(null);
                }}
              >
                Back to Crew
              </button>
              {lobby.host === profile.me.id && (
                <button
                  className="secondary"
                  onClick={() => runAction(async () => { await crew.closeRoom(); setLobby(null); await refresh(); })}
                >
                  Close Lobby
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <span className="eyebrow">SQUADRON · PILOT CODE {profile.me.code}</span>
            <h2>{profile.me.name}’s Crew</h2>
            <div className="btn-row" style={{ marginBottom: 14 }}>
              <button
                className="secondary"
                onClick={() => {
                  navigator.clipboard?.writeText(profile.me.code).catch(() => {});
                  setNotice({ text: `Copied pilot code ${profile.me.code}.`, error: false });
                }}
              >
                Copy Code ({profile.me.code})
              </button>
              <button
                className="secondary"
                onClick={() => runAction(async () => { await crew.logout(); setProfile(null); })}
              >
                Sign Out
              </button>
            </div>

            <form
              className="crew-invite"
              style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}
              onSubmit={(e) => {
                e.preventDefault();
                runAction(async () => {
                  const res = await crew.invite(friendCode);
                  setFriendCode('');
                  setNotice({ text: res.message, error: false });
                  await refresh();
                });
              }}
            >
              <input
                value={friendCode}
                onChange={(e) => setFriendCode(e.target.value)}
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="6-digit friend code"
                required
              />
              <button className="primary" style={{ margin: 0 }} type="submit">
                Send Invite
              </button>
            </form>

            {invites.length > 0 && (
              <>
                <h3>Pending Requests</h3>
                <ul className="crew-list">
                  {invites.map((other) => (
                    <li key={other.id}>
                      <strong>{other.name}</strong>
                      {other.invited === profile.me.id ? (
                        <span>Sent</span>
                      ) : (
                        <div className="btn-row" style={{ margin: 0 }}>
                          <button
                            className="secondary"
                            onClick={() => runAction(async () => { await crew.respondFriend(other.id, true); await refresh(); })}
                          >
                            Accept
                          </button>
                          <button
                            className="secondary"
                            onClick={() => runAction(async () => { await crew.respondFriend(other.id, false); await refresh(); })}
                          >
                            Decline
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {profile.rooms.length > 0 && (
              <>
                <h3>Active Lobbies</h3>
                <ul className="crew-list">
                  {profile.rooms.map((room) => (
                    <li key={room.id}>
                      <strong>
                        {room.members[0]?.name} · {room.rules.mode === 'duel' ? 'Deathmatch' : 'vs Bots'}
                      </strong>
                      <button
                        className="primary"
                        style={{ margin: 0, padding: '6px 14px' }}
                        onClick={() =>
                          runAction(async () => {
                            onActivateAudio();
                            if (room.state === 'invited') await crew.respondRoom(room.id, true);
                            await crew.connect(room.id, currentPlane % 3);
                          })
                        }
                      >
                        {room.state === 'invited' ? 'Join' : 'Open'}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h3>Create Match</h3>
            <div className="crew-rules">
              <label>
                Players
                <select
                  value={rules.seats}
                  onChange={(e) => setRules({ ...rules, seats: Number(e.target.value) as 2 | 4 })}
                >
                  <option value={2}>2 Players</option>
                  <option value={4}>4 Players</option>
                </select>
              </label>
              <label>
                Mode
                <select
                  value={rules.mode}
                  onChange={(e) => setRules({ ...rules, mode: e.target.value as 'duel' | 'bots' })}
                >
                  <option value="duel">Deathmatch</option>
                  <option value="bots">Crew vs Bots</option>
                </select>
              </label>
              <label>
                Map
                <select
                  value={rules.map}
                  onChange={(e) => setRules({ ...rules, map: Number(e.target.value) as 0 | 1 })}
                >
                  <option value={0}>Ember Canyon</option>
                  <option value={1}>Frostline Reach</option>
                </select>
              </label>
              <label>
                Length
                <select
                  value={rules.seconds}
                  onChange={(e) => setRules({ ...rules, seconds: Number(e.target.value) as 180 | 300 })}
                >
                  <option value={180}>3 min</option>
                  <option value={300}>5 min</option>
                </select>
              </label>
            </div>

            {friends.length > 0 ? (
              <ul className="crew-list">
                {friends.map((f) => (
                  <li key={f.id}>
                    <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={selectedFriends.includes(f.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedFriends((prev) => [...prev.slice(0, rules.seats - 2), f.id]);
                          } else {
                            setSelectedFriends((prev) => prev.filter((x) => x !== f.id));
                          }
                        }}
                      />
                      <strong>{f.name}</strong>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Accepted crewmates will appear here.</p>
            )}

            <button
              className="primary"
              disabled={selectedFriends.length !== rules.seats - 1 || busy}
              onClick={() =>
                runAction(async () => {
                  onActivateAudio();
                  const { room } = await crew.createRoom(selectedFriends, rules);
                  await crew.connect(room.id, currentPlane % 3);
                })
              }
            >
              Create Lobby &amp; Invite
            </button>
          </>
        )}

        {notice.text && (
          <p style={{ color: notice.error ? '#ffb4a8' : '#bdeadf', marginTop: 14 }}>{notice.text}</p>
        )}
      </div>
    </div>
  );
};
