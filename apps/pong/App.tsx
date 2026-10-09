// pong: two-player Pong between two browsers, on the CRT. The suite's top bar
// on top; the screens (menu, waiting, joining, the game) stay mounted and
// show one at a time, so the field and its loop live as long as the page.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DISTRIBUTION } from '../../shared/distribution.js';
import { qrSvg } from '../../shared/qr.js';
import { useMount } from '../../ui/AppShell';
import { Icon, TopBar } from '../../ui/components';
import { useKiwi, useTick } from '../../ui/hooks';
import { Pong, secretOf } from './engine.js';

export function PongApp() {
  const kiwi = useKiwi();
  const mount = useMount();
  const pong = useMemo(() => new Pong(), []);
  useTick(useCallback((fn: () => void) => pong.onChange(fn), [pong]));
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState(pong.name);
  const [code, setCode] = useState('');

  useEffect(() => {
    pong.start();
    const detach = canvas.current ? pong.attach(canvas.current) : () => {};
    const route = () => pong.route();
    addEventListener('hashchange', route);
    pong.route();
    return () => {
      removeEventListener('hashchange', route);
      detach();
      pong.stop();
    };
  }, [pong]);
  useEffect(() => {
    document.title = mount.name;
  }, [mount.name]);

  const v = pong.view;
  const S = pong.session;
  const copy = async () => {
    await navigator.clipboard.writeText(v.link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const press = (key: 'up' | 'down') => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      pong.press(key, true);
    },
    onPointerUp: () => pong.press(key, false),
    onPointerCancel: () => pong.press(key, false),
    onPointerLeave: () => pong.press(key, false),
  });
  const games = pong.openGames();

  return (
    <>
      <TopBar
        brand={{
          href: './',
          name: mount.name,
          mark: (
            <span className="wjs-app-mark" aria-hidden="true">
              <Icon name={mount.icon} />
            </span>
          ),
        }}
      />
      <div className="crt">
        <div className="scanlines" />
        <div className="content">
          <header>
            <h1>
              <a href="./">PONG.JS</a>
            </h1>
            <p className="subtitle">*** 2 PLAYER · PEER TO PEER ***</p>
          </header>

          <section id="menu" className="screen" hidden={v.screen !== 'menu'}>
            <label className="field">
              NAME{' '}
              <input
                id="name"
                maxLength={12}
                autoComplete="nickname"
                spellCheck={false}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  pong.setName(e.target.value);
                }}
              />
            </label>
            <div className="buttons">
              <button type="button" id="hostBtn" onClick={() => void pong.host()}>
                [1] HOST GAME
              </button>
              <button type="button" id="cpuBtn" onClick={() => pong.practice()}>
                [2] PRACTICE VS CPU
              </button>
            </div>
            <form
              id="joinForm"
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                const secret = secretOf(code);
                if (secret) location.hash = secret;
                else setCode('');
              }}
            >
              <input
                name="code"
                placeholder="PASTE A GAME LINK"
                autoComplete="off"
                spellCheck={false}
                aria-label="Game link"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button type="submit">[3] JOIN</button>
            </form>
            <div className="lobby">
              <h2>OPEN GAMES</h2>
              <ul id="lobby">
                {games.length ? (
                  games.map((g: any) => (
                    <li key={g.secret}>
                      <button type="button" onClick={() => (location.hash = g.secret)}>
                        ▶ {g.name}
                      </button>
                    </li>
                  ))
                ) : (
                  <li className="dim">NONE RIGHT NOW</li>
                )}
              </ul>
            </div>
          </section>

          <section id="wait" className="screen" hidden={v.screen !== 'wait'}>
            <h2>
              WAITING FOR PLAYER 2<span className="blink">_</span>
            </h2>
            <p>SEND THEM THIS LINK</p>
            <div className="row">
              <input id="link" readOnly aria-label="Game link" spellCheck={false} value={v.link} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" id="copyLink" onClick={() => void copy()}>
                {copied ? '[COPIED]' : '[COPY]'}
              </button>
            </div>
            <div id="qr" className="qr" dangerouslySetInnerHTML={{ __html: v.link ? qrSvg(v.link) : '' }} />
            <label className="check">
              <input type="checkbox" id="listPublic" checked={pong.listPublic} onChange={(e) => pong.setListPublic(e.target.checked)} /> LIST UNDER OPEN GAMES
            </label>
            <button type="button" id="cancelWait" onClick={() => pong.end()}>
              [CANCEL]
            </button>
          </section>

          <section id="joining" className="screen" hidden={v.screen !== 'joining'}>
            <h2>
              JOINING<span className="blink">_</span>
            </h2>
            <p id="joinStatus">{v.joinStatus}</p>
            <button type="button" id="cancelJoin" onClick={() => pong.end()}>
              [CANCEL]
            </button>
          </section>

          <section id="game" className="screen" hidden={v.screen !== 'game'}>
            <div className="hud">
              <span id="leftName">{v.names.l}</span>
              <span id="netInfo" className="dim">
                {S ? v.netInfo : ''}
              </span>
              <span id="rightName">{v.names.r}</span>
            </div>
            <div className="stage">
              <canvas id="pong" ref={canvas} width={800} height={500} aria-label="Pong field" />
              <div id="overlay" className="overlay" hidden={!v.overlay}>
                {v.overlay ? (
                  <>
                    <div>
                      <h2>
                        {v.overlay.title}
                        {v.overlay.blink ? <span className="blink">_</span> : null}
                      </h2>
                      {v.overlay.score ? <p>{v.overlay.score}</p> : null}
                      {v.overlay.line ? <p className="dim">{v.overlay.line}</p> : null}
                    </div>
                    <div className="buttons">
                      {v.overlay.buttons.map(([act, label]: [string, string]) => (
                        <button key={act} type="button" data-act={act} onClick={() => pong.act(act)}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
            <div className="touch">
              <button type="button" id="upBtn" aria-label="Paddle up" {...press('up')}>
                ▲
              </button>
              <button type="button" id="downBtn" aria-label="Paddle down" {...press('down')}>
                ▼
              </button>
            </div>
            <p className="hint">W/S OR ↑/↓ · MOUSE OR TOUCH · M: SOUND · FIRST TO 7</p>
            <div className="buttons">
              <button type="button" id="muteBtn" onClick={() => pong.toggleMute()}>
                {pong.muted ? '[SOUND OFF]' : '[SOUND ON]'}
              </button>
              <button type="button" id="menuBtn" onClick={() => pong.end()}>
                [MENU]
              </button>
            </div>
          </section>

          <footer>
            <span id="relays" className={v.relaysUp ? '' : 'dim'}>{`RELAYS ${v.relaysUp}/${pong.relayList.length}`}</span> ·{' '}
            <a href={kiwi.base}>{DISTRIBUTION.name.toUpperCase()}</a>
          </footer>
        </div>
      </div>
    </>
  );
}
