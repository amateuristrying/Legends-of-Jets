interface Props {
  aircraft: string;
  aircraftRole: string;
  map: string;
  atmosphere: string;
  repository: string;
  inactive: boolean;
  open: (panel: 'pilotlog' | 'maps' | 'planes' | 'settings' | 'campaign' | 'skirmish' | 'timetrial' | 'crew') => void;
  launch: (mode: 'endless' | 'survival') => void;
}

export function Hangar({ aircraft, aircraftRole, map, atmosphere, repository, inactive, open, launch }: Props) {
  const modes = [
    { name: 'Campaign', detail: '30 story missions', action: () => open('campaign') },
    { name: 'Skirmish', detail: 'Custom battles vs. AI', action: () => open('skirmish') },
    { name: 'Time Trials', detail: 'Caldera & Glacier', action: () => open('timetrial') },
    { name: 'Survival', detail: 'Endless enemy waves', action: () => launch('survival') },
    { name: 'Crew', detail: 'Online duels & co-op', action: () => open('crew') },
    { name: 'Endless', detail: 'Free flight', action: () => launch('endless') },
  ];

  return (
    <main id="hangar" inert={inactive} aria-label="Flight deck">
      <header className="deck-header" data-hangar-intro>
        <div className="brand deck-brand">
          <i className="deck-mark" aria-hidden="true" />
          <span className="deck-wordmark">LEGENDS <em>OF</em> JETS</span>
        </div>
        <nav aria-label="Flight deck">
          <button onClick={() => open('pilotlog')}>Pilot Log</button>
          <button onClick={() => open('maps')}>Maps</button>
          <button onClick={() => open('planes')}>Planes</button>
          <button onClick={() => open('settings')}>Settings</button>
          <span className="divider" aria-hidden="true">|</span>
          <a href={repository} target="_blank" rel="noreferrer">GitHub <span aria-hidden="true">↗</span></a>
        </nav>
      </header>

      <div className="deck-main">
        <section className="hangar-caption" data-hangar-intro>
          <h1>Choose your <br /><span>flight.</span></h1>
        </section>

        <section className="aircraft-caption" data-hangar-intro aria-label="Selected aircraft">
          <div className="aircraft-selection" data-aircraft>
            <span className="eyebrow">{aircraftRole}</span>
            <h2>{aircraft}</h2>
          </div>
          <button onClick={() => open('planes')}>Change aircraft <span aria-hidden="true">↗</span></button>
        </section>
      </div>

      <div className="deck-bottom">
        <section className="mode-dock" aria-label="Flight modes">
          {modes.map(({ name, detail, action }) => (
            <button key={name} className={name === 'Endless' ? 'mode endless' : 'mode'} onClick={action}>
              <strong>{name}</strong>
              <small>{detail}</small>
              <span className="mode-arrow" aria-hidden="true">↗</span>
            </button>
          ))}
        </section>

        <footer className="deck-footer" data-hangar-intro>
          <button onClick={() => open('maps')}>{map} <span> / {atmosphere}</span></button>
          <span className="preview-status"><i aria-hidden="true" /> Flight preview</span>
        </footer>
      </div>
    </main>
  );
}
