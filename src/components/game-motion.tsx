import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { gsap } from 'gsap';

const motionAllowed = '(prefers-reduced-motion: no-preference)';

export function GameLoading({ ready, status }: { ready: boolean; status: string }) {
  const screen = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);

  useLayoutEffect(() => {
    const element = screen.current;
    if (!ready || !element) return;
    if (!window.matchMedia(motionAllowed).matches) {
      setVisible(false);
      return;
    }
    const tween = gsap.to(element, { opacity: 0, duration: 0.26, ease: 'power2.out', onComplete: () => setVisible(false) });
    return () => { tween.kill(); };
  }, [ready]);

  return visible && (
    <div id="loading" ref={screen} role="status">
      <i className="deck-mark" aria-hidden="true" />
      <div className="brand">LEGENDS <span>OF</span> JETS</div>
      <p>{status}</p>
      <div className="loadtrack" aria-hidden="true"><i /></div>
    </div>
  );
}

export function useGameMotion(
  root: RefObject<HTMLDivElement | null>,
  scene: 'hangar' | 'flight',
  modal: string | null,
  loading: boolean,
  aircraft: number
): void {
  useLayoutEffect(() => {
    const surface = root.current;
    if (loading || !surface) return;
    const media = gsap.matchMedia(surface);
    media.add(motionAllowed, () => {
      const timeline = gsap.timeline({ defaults: { ease: 'power3.out', clearProps: 'transform,opacity' } });
      if (scene === 'hangar') {
        timeline
          .from('[data-hangar-intro]', { opacity: 0, y: 12, duration: 0.5, stagger: 0.055 }, 0)
          .from('.mode-dock .mode', { opacity: 0, y: 14, duration: 0.38, stagger: 0.035 }, 0.09);
      } else {
        timeline.from('.hud-top', { opacity: 0, y: -8, duration: 0.24 }, 0);
      }
    });
    return () => media.revert();
  }, [root, scene, loading]);

  useLayoutEffect(() => {
    const element = root.current?.querySelector('[data-aircraft]');
    if (!element || loading || scene !== 'hangar') return;
    const media = gsap.matchMedia();
    media.add(motionAllowed, () => {
      gsap.from(element, { y: 5, opacity: 0.45, duration: 0.28, ease: 'power2.out', clearProps: 'opacity,transform' });
    });
    return () => media.revert();
  }, [root, scene, loading, aircraft]);

  useLayoutEffect(() => {
    const backdrop = root.current?.querySelector<HTMLElement>('.modal-backdrop');
    const panel = backdrop?.querySelector<HTMLElement>('.modal-panel');
    if (!modal || !backdrop || !panel) return;

    const previousFocus = document.activeElement;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', panel.querySelector('h2')?.textContent?.trim() || 'Game menu');
    panel.tabIndex = -1;
    const close = panel.querySelector<HTMLButtonElement>('.close-btn');
    (close ?? panel).focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && close) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) close.click();
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'
      )).filter(element => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      const current = document.activeElement;
      if ((event.shiftKey && (current === first || current === panel)) || (!event.shiftKey && current === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    panel.addEventListener('keydown', onKey);
    const media = gsap.matchMedia();
    media.add(motionAllowed, () => {
      gsap.from(backdrop, { opacity: 0, duration: 0.18, ease: 'power1.out', clearProps: 'opacity' });
      gsap.from(panel, { y: 14, scale: 0.99, duration: 0.3, ease: 'power3.out', clearProps: 'transform' });
    });
    return () => {
      media.revert();
      panel.removeEventListener('keydown', onKey);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected && !previousFocus.closest('[inert]')) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [root, modal]);
}
