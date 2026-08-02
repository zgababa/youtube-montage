/**
 * The scrubber, in the same terms the exporter uses.
 *
 * Previews are never served as files — the HTML is read server-side and dropped
 * into `srcDoc` with `sandbox="allow-scripts"` and *without* `allow-same-origin`
 * (idea.md §10). That means the parent page cannot reach into the iframe's
 * document, so scrubbing goes over `postMessage` to this controller, which is
 * appended to the scene HTML at render time.
 *
 * It drives `document.getAnimations()` exactly like `render.ts` does when
 * frame-stepping: pause everything, set `currentTime`. A scene that scrubs
 * correctly here is a scene that exports correctly.
 */

export const SCENE_MESSAGE_TARGET = "scene-preview"

/**
 * The preview's `omitBackground: true`.
 *
 * Scenes deliberately set no background (§5) — but a browser paints an
 * embedded document's canvas white by default, which would hide the fact that
 * the scene is an overlay. Playwright solves this at screenshot time with
 * `omitBackground`; the preview solves it here. Scene markup is untouched.
 *
 * The `color-scheme` meta is load-bearing, not decoration. A document that
 * declares no colour scheme gets the UA's opaque light canvas, and that used
 * value wins over an author `background-color: transparent` — the frame renders
 * solid white no matter how `!important` the rule is. Declaring a scheme hands
 * the canvas back to the author. Both halves are required.
 */
const TRANSPARENT_CANVAS = `
<meta name="color-scheme" content="dark light">
<style>html, body { background-color: transparent !important; }</style>
`

const CONTROLLER = `
<script>
(function () {
  var TARGET = ${JSON.stringify(SCENE_MESSAGE_TARGET)};

  function animations() {
    return document.getAnimations();
  }

  function totalDurationSec() {
    var max = 0;
    var list = animations();
    for (var i = 0; i < list.length; i++) {
      var effect = list[i].effect;
      if (!effect || !effect.getComputedTiming) continue;
      var end = effect.getComputedTiming().endTime;
      if (typeof end === "number" && isFinite(end) && end > max) max = end;
    }
    return max / 1000;
  }

  function seek(ms) {
    var list = animations();
    // Refuse to pause an empty set: that would strand the scene on its
    // from-state and look identical to a scene that renders nothing.
    if (list.length === 0) return;
    for (var i = 0; i < list.length; i++) {
      try {
        list[i].pause();
        list[i].currentTime = ms;
      } catch (err) {}
    }
  }

  function restart() {
    var list = animations();
    for (var i = 0; i < list.length; i++) {
      try {
        list[i].currentTime = 0;
        list[i].play();
      } catch (err) {}
    }
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.target !== TARGET) return;
    if (data.type === "seek") seek(data.ms);
    else if (data.type === "play") restart();
    else if (data.type === "pause") seek(data.ms);
  });

  var announced = false;

  function announce() {
    if (announced) return;
    var duration = totalDurationSec();
    // A document that loads while hidden has no running animations yet, so
    // getAnimations() comes back empty and the measured duration is 0. Keep
    // asking rather than reporting a scene that is 0 seconds long.
    if (duration <= 0) return;
    announced = true;
    parent.postMessage({ source: TARGET, type: "ready", durationSec: duration }, "*");
  }

  function poll(remaining) {
    announce();
    if (announced || remaining <= 0) return;
    setTimeout(function () {
      poll(remaining - 1);
    }, 100);
  }

  function start() {
    poll(50);
  }

  document.addEventListener("visibilitychange", start);
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);
})();
</script>
`

/**
 * The frame a scene streams into while it is still being written.
 *
 * A finished scene goes into `srcDoc`, but a scene arriving a few characters at
 * a time cannot: every assignment reloads the frame, which restarts the
 * animations and flashes the card ten times a second. So the frame is loaded
 * once with this shell, and each chunk is `document.write`n into it — the same
 * incremental parse the browser does for any streamed page, which is why a
 * half-finished document renders as a half-finished *scene* rather than as
 * markup.
 *
 * Two details are load-bearing:
 *
 *   - `document.open()` removes every listener registered on the window, so the
 *     shell reinstalls its own from a script in the prefix it writes. Without
 *     that, exactly one chunk ever lands and the scene stops mid-sentence.
 *   - The prefix leads with a doctype. The scene's own doctype arrives later,
 *     by which point it is a stray token the parser drops — so writing one
 *     first is the only way the draft renders in standards mode, and the only
 *     way its layout matches the finished frame's.
 */
export const SCENE_DRAFT_SHELL = `
<!doctype html>
<html>
  <head></head>
  <body>
    <script>
      (function () {
        var TARGET = ${JSON.stringify(SCENE_MESSAGE_TARGET)};
        var PREFIX =
          "<!doctype html>" +
          ${JSON.stringify(TRANSPARENT_CANVAS)} +
          "<" + "script>window.__install && window.__install()<" + "/script>";

        function onMessage(event) {
          var data = event.data;
          if (!data || data.target !== TARGET) return;
          if (data.type !== "draft") return;
          try {
            if (!window.__opened) {
              window.__opened = true;
              document.open();
              document.write(PREFIX);
            }
            document.write(data.chunk);
          } catch (err) {}
        }

        // Reachable from the written prefix, which runs in a document that no
        // longer has this script in it.
        window.__install = function () {
          window.removeEventListener("message", onMessage);
          window.addEventListener("message", onMessage);
        };

        window.__install();
        parent.postMessage({ source: TARGET, type: "draft-ready" }, "*");
      })();
    </script>
  </body>
</html>
`.trim()

/** Appends the controller to a generated scene without touching its markup. */
export function withSceneController(html: string) {
  // The canvas bits go in the head — a `color-scheme` meta is only honoured
  // there — and the controller at the end of the body, after the markup it
  // animates.
  const withCanvas = html.includes("<head>")
    ? html.replace("<head>", `<head>${TRANSPARENT_CANVAS}`)
    : TRANSPARENT_CANVAS + html

  return withCanvas.includes("</body>")
    ? withCanvas.replace("</body>", `${CONTROLLER}</body>`)
    : withCanvas + CONTROLLER
}

export type SceneMessage =
  | { target: typeof SCENE_MESSAGE_TARGET; type: "seek"; ms: number }
  | { target: typeof SCENE_MESSAGE_TARGET; type: "pause"; ms: number }
  | { target: typeof SCENE_MESSAGE_TARGET; type: "play" }
  /** Appended to the draft frame's open document. Never a whole document. */
  | { target: typeof SCENE_MESSAGE_TARGET; type: "draft"; chunk: string }
