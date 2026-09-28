import { Game } from './game/Game';
import { installQa } from './game/qa';

function fail(message: string): void {
  const boot = document.getElementById('boot');
  if (boot) boot.innerHTML = `<div class="boot-error"><h1>No se pudo iniciar</h1><p>${message}</p></div>`;
}

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

function main(): void {
  const params = new URLSearchParams(window.location.search);
  const qa = params.get('qa') === '1';
  const q = params.get('q');
  const quality = q === 'low' || q === 'medium' || q === 'high' ? q : undefined;

  if (!hasWebGL2()) {
    fail('Este juego necesita WebGL 2. Actualiza el navegador o activa la aceleración por hardware.');
    return;
  }
  const app = document.getElementById('app');
  if (!app) return;
  const canvas = document.createElement('canvas');
  canvas.id = 'game-canvas';
  canvas.setAttribute('aria-label', 'Vista del juego');
  app.prepend(canvas);

  // Deja pintar el mensaje de carga antes de generar el mundo (bloquea el hilo un momento).
  requestAnimationFrame(() =>
    setTimeout(() => {
      try {
        const game = new Game({ canvas, qa, quality });
        if (qa) installQa(game);
        game.start();
        document.getElementById('boot')?.remove();
      } catch (err) {
        console.error(err);
        fail(err instanceof Error ? err.message : String(err));
      }
    }, 0),
  );
}

main();
