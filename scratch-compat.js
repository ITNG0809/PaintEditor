/* ======================================================================
   scratch-compat.js — Scratch / TurboWarp 互換レイヤー
   1) Canvas版 scratch-render 互換  → window.createPaintRenderer
      （旧 tw-canvas-compat.js）
   2) Scratch3ブロック → PaintEditorブロック変換 → window.ScratchProgramImport
      （旧 scratch-program-import.js）
   ※ animation.js より前に読み込むこと
   ====================================================================== */

/* -------- 1) 旧 tw-canvas-compat.js -------- */
/* Canvas-backed subset of scratch-render. No WebGL context is impersonated. */
(function (global) {
  "use strict";

  global.createPaintRenderer = function (bridge) {
    const drawables = [];
    const skins = [];
    const byTarget = new Map();
    const textures = new Set();
    let nextSkinId = 0;
    let nextDrawableId = 0;

    class Events {
      constructor() {
        this.listeners = new Map();
      }
      on(name, fn) {
        if (!this.listeners.has(name)) this.listeners.set(name, new Set());
        this.listeners.get(name).add(fn);
        return this;
      }
      off(name, fn) {
        this.listeners.get(name)?.delete(fn);
        return this;
      }
      removeListener(name, fn) {
        return this.off(name, fn);
      }
      emit(name, ...args) {
        for (const fn of [...(this.listeners.get(name) || [])]) fn(...args);
      }
    }

    function createTexture(owner, options = {}) {
      const texture = { canvas: document.createElement("canvas"), owner, disposed: false };
      textures.add(texture);
      if (options.src) upload(texture, options.src);
      return texture;
    }
    function upload(texture, source) {
      if (!textures.has(texture) || texture.disposed) throw Error("Texture has been released");
      const width = source.width || 0,
        height = source.height || 0;
      // Bound memory rather than silently exhausting the tab with an extension texture.
      if (width > 16384 || height > 16384 || width * height > 16777216) {
        throw Error("Canvas texture exceeds PaintEditor limit (16 megapixels)");
      }
      texture.canvas.width = width;
      texture.canvas.height = height;
      if (width && height) {
        const ctx = texture.canvas.getContext("2d");
        if (source instanceof ImageData) ctx.putImageData(source, 0, 0);
        else ctx.drawImage(source, 0, 0);
      }
    }
    function deleteTexture(texture) {
      if (!texture || !textures.has(texture)) return;
      texture.canvas.width = texture.canvas.height = 0;
      texture.disposed = true;
      textures.delete(texture);
    }

    class Silhouette {
      constructor() {
        this.data = null;
        this.source = null;
      }
      update(source) {
        this.source = source;
        this.data = null;
      }
      unlazy() {
        if (!this.data && this.source?.width && this.source?.height) {
          this.data = this.source
            .getContext("2d")
            .getImageData(0, 0, this.source.width, this.source.height);
        }
      }
      isTouchingNearest(point) {
        this.unlazy();
        if (!this.data) return false;
        const x = Math.floor(point[0] * this.data.width);
        const y = Math.floor(point[1] * this.data.height);
        return (
          x >= 0 &&
          y >= 0 &&
          x < this.data.width &&
          y < this.data.height &&
          this.data.data[(y * this.data.width + x) * 4 + 3] > 0
        );
      }
      dispose() {
        this.source = this.data = null;
      }
    }

    class Skin extends Events {
      constructor(id, renderer, owner) {
        super();
        this.id = id;
        this._renderer = renderer;
        this.owner = owner;
        this._texture = null;
        this._rotationCenter = [0, 0, 0];
        this._silhouette = new Silhouette();
      }
      get rotationCenter() {
        return this._rotationCenter;
      }
      _setTexture(source) {
        if (!this._texture) this._texture = createTexture(this.owner);
        upload(this._texture, source);
        this._silhouette.update(this._texture.canvas);
      }
      emitWasAltered() {
        this.emit("WasAltered");
        bridge.redraw();
      }
      dispose() {
        deleteTexture(this._texture);
        this._texture = null;
        this._silhouette.dispose();
        this.listeners.clear();
      }
    }

    class CanvasMeasurementProvider {
      constructor(ctx) {
        this.ctx = ctx;
      }
      measureText(text) {
        return this.ctx.measureText(text).width;
      }
    }

    function createTextWrapper(provider) {
      return {
        wrapText(width, text) {
          const lines = [];
          // Prefer word boundaries; fall back to graphemes for CJK and long words.
          const segmenter =
            typeof Intl.Segmenter === "function"
              ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
              : null;
          const chars = (s) =>
            segmenter ? [...segmenter.segment(s)].map((x) => x.segment) : Array.from(s);
          for (const paragraph of String(text).replace(/\r\n?/g, "\n").split("\n")) {
            let line = "";
            for (const word of paragraph.match(/\S+\s*|\s+/gu) || []) {
              if (line && provider.measureText(line + word.trimEnd()) > width) {
                lines.push(line);
                line = "";
              }
              for (const char of chars(word)) {
                if (line && !/^\s$/u.test(char) && provider.measureText(line + char) > width) {
                  lines.push(line);
                  line = "";
                }
                line += char;
              }
            }
            lines.push(line);
          }
          return lines;
        },
      };
    }

    function drawableFor(target) {
      let d = byTarget.get(target.id);
      if (!d) {
        d = {
          id: nextDrawableId++,
          target,
          skin: null,
          costume: target.c,
          get scale() {
            return [this.target.size, this.target.size];
          },
        };
        byTarget.set(target.id, d);
        drawables[d.id] = d;
      }
      if (d.costume !== target.c) {
        d.skin = null;
        d.costume = target.c;
      }
      return d;
    }
    function destroySkin(id) {
      const skin = skins[id];
      if (!skin) return;
      // Official TextCostumeSkin.dispose does not cancel its timers.
      if (typeof skin.cancelAnimation === "function") skin.cancelAnimation();
      for (const d of drawables) if (d?.skin === skin) d.skin = null;
      skin.dispose();
      delete skins[id];
      bridge.redraw();
    }
    function surface(target, pixelScale = 1) {
      const d = byTarget.get(target.id);
      if (!d) return null;
      // Effect rendering uses a shallow copy of the target; keep the real target in the drawable.
      drawableFor(d.target);
      const skin = d.skin;
      if (!skin) return null;
      const scale = Math.max(0.01, Math.abs(target.size)) * Math.max(1, pixelScale);
      const texture = skin.getTexture([scale, scale]);
      const size = skin.size;
      return { skin, texture, size, center: skin.rotationCenter };
    }
    const api = {
      drawableFor,
      clearCostume(target) {
        const d = byTarget.get(target.id);
        if (d) d.skin = null;
        bridge.redraw();
      },
      surface,
      draw(ctx, target, pixelScale) {
        const s = surface(target, pixelScale);
        if (!s) return false;
        if (!target.vis || target.size <= 0 || !s.texture?.canvas.width || !s.texture.canvas.height)
          return true;
        ctx.save();
        ctx.globalAlpha *= Math.max(0, Math.min(1, 1 - target.ghost / 100));
        ctx.translate(240 + target.x, 180 - target.y);
        ctx.rotate(((target.dir - 90) * Math.PI) / 180);
        ctx.scale(target.size / 100, target.size / 100);
        ctx.imageSmoothingEnabled = !s.skin.useNearest?.();
        ctx.drawImage(s.texture.canvas, -s.center[0], -s.center[1], s.size[0], s.size[1]);
        ctx.restore();
        return true;
      },
      box(target) {
        const s = surface(target);
        return s
          ? [-s.center[0], -s.center[1], s.size[0] - s.center[0], s.size[1] - s.center[1]]
          : null;
      },
      hit(target, x, y) {
        const s = surface(target);
        if (!s) return null;
        const [w, h] = s.size;
        if (!w || !h) return false;
        return s.skin._silhouette.isTouchingNearest([(x + s.center[0]) / w, (y + s.center[1]) / h]);
      },
      removeTarget(target) {
        const d = byTarget.get(target.id);
        if (!d) return;
        // A skin can be allocated but not currently attached to its drawable.
        for (const skin of skins) if (skin?.drawable === d) destroySkin(skin.id);
        delete drawables[d.id];
        byTarget.delete(target.id);
      },
      release(owner) {
        for (const skin of skins) if (skin?.owner === owner) destroySkin(skin.id);
        for (const texture of [...textures]) if (texture.owner === owner) deleteTexture(texture);
      },
      forSource(owner) {
        // Prototype patches belong to one extension load, never to other extensions or reloads.
        class RenderedTarget {
          constructor(target) {
            this.nativeTarget = target;
          }
          get drawableID() {
            return drawableFor(this.nativeTarget).id;
          }
          makeClone() {
            return bridge.clone(this.nativeTarget, owner);
          }
        }
        const gl = new Proxy(
          {
            CLAMP_TO_EDGE: 33071,
            deleteTexture,
          },
          {
            get(obj, prop) {
              if (prop in obj) return obj[prop];
              throw Error("PaintEditor Canvas renderer: unsupported WebGL API " + String(prop));
            },
          },
        );
        const renderer = {
          gl,
          _allDrawables: drawables,
          _allSkins: skins,
          get _nextSkinId() {
            return nextSkinId;
          },
          set _nextSkinId(value) {
            nextSkinId = value;
          },
          createTextWrapper,
          updateDrawableSkinId(drawableID, skinID) {
            const d = drawables[drawableID],
              skin = skins[skinID];
            if (!d || !skin) throw Error("Unknown drawable or skin");
            d.skin = skin;
            d.costume = d.target.c;
            bridge.redraw();
          },
          destroySkin,
        };
        renderer.exports = {
          Skin: class extends Skin {
            constructor(id, r) {
              super(id, r, owner);
            }
          },
          CanvasMeasurementProvider,
          twgl: {
            createTexture(context, options) {
              if (context !== gl) throw Error("Expected this source's Canvas texture adapter");
              if (Object.keys(options || {}).some((k) => !["auto", "wrap", "src"].includes(k))) {
                throw Error("Unsupported Canvas texture option");
              }
              return createTexture(owner, options);
            },
          },
        };
        return { renderer, RenderedTarget };
      },
    };
    return api;
  };
})(window);

/* -------- 2) 旧 scratch-program-import.js -------- */
/* Scratch 3 block graph -> PaintEditor's existing editable block tree.
 * Original Scratch JSON remains on the sprite for lossless Scratch re-export.
 */
(function (global) {
  "use strict";
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const rules = Object.create(null);
  const rule = (input, output, args = {}) => {
    rules[input] = { output, args };
  };

  rule("event_whenflagclicked", "event_whenflag");
  rule("event_whenkeypressed", "event_whenkey", { KEY: "@KEY_OPTION" });
  rule("event_whenthisspriteclicked", "event_whenclicked");
  rule("event_whenstageclicked", "event_whenclicked");
  rule("event_whenbroadcastreceived", "event_whenbroadcast", { MSG: "@BROADCAST_OPTION" });
  rule("event_broadcast", "msg_send", { MSG: "BROADCAST_INPUT" });
  rule("event_broadcastandwait", "msg_sendwait", { MSG: "BROADCAST_INPUT" });
  rule("event_whengreaterthan", "event_whengt", { W: "@WHENGREATERTHANMENU", N: "VALUE" });
  rule("sound_play", "sound_start", { S: "SOUND_MENU" });
  rule("sound_playuntildone", "sound_playwait", { S: "SOUND_MENU" });
  rule("sound_stopallsounds", "sound_stopall");
  rule("sound_setvolumeto", "sound_setvolume", { V: "VOLUME" });
  rule("sound_changevolumeby", "sound_changevolume", { V: "VOLUME" });
  rule("sound_volume", "sound_volume");
  rule("sound_seteffectto", "sound_fxset", { E: "@EFFECT", V: "VALUE" });
  rule("sound_changeeffectby", "sound_fxchange", { E: "@EFFECT", V: "VALUE" });
  rule("sound_cleareffects", "sound_fxclear");
  rule("sensing_loudness", "sense_loudness");
  rule("event_whenbackdropswitchesto", "event_whenbackdrop", { B: "@BACKDROP" });
  rule("looks_switchbackdropto", "looks_switchbackdrop", { B: "BACKDROP" });
  rule("looks_switchbackdroptoandwait", "looks_switchbackdropwait", { B: "BACKDROP" });
  rule("looks_nextbackdrop", "looks_nextbackdrop");
  rule("looks_backdropnumbername", "looks_backdropnn", { NN: "@NUMBER_NAME" });
  rule("motion_setrotationstyle", "motion_setrotstyle", { ROT: "@STYLE" });
  rule("music_setTempo", "music_settempo", { T: "TEMPO" });
  rule("music_changeTempo", "music_changetempo", { T: "TEMPO" });
  rule("music_getTempo", "music_gettempo");

  rule("stretch_setStretchX", "looks_setstretchx", { X: "X" });
  rule("stretch_setStretchY", "looks_setstretchy", { Y: "Y" });
  rule("stretch_setStretch", "looks_setstretch", { X: "X", Y: "Y" });
  rule("stretch_changeStretch", "looks_changestretch", { X: "DX", Y: "DY" });
  rule("stretch_getX", "looks_stretchx");
  rule("stretch_getY", "looks_stretchy");
  rule("motion_movesteps", "motion_move", { N: "STEPS" });
  rule("motion_turnright", "motion_turn", { DEG: "DEGREES" });
  rule("motion_turnleft", "motion_turnleft", { DEG: "DEGREES" });
  rule("motion_gotoxy", "motion_goto", { X: "X", Y: "Y" });
  rule("motion_goto", "motion_gotot", { T: "TO" });
  rule("motion_glidesecstoxy", "motion_glide", { SECS: "SECS", X: "X", Y: "Y" });
  rule("motion_glideto", "motion_glidet", { SECS: "SECS", T: "TO" });
  rule("motion_pointindirection", "motion_pointdir", { DIR: "DIRECTION" });
  rule("motion_pointtowards", "motion_towards", { T: "TOWARDS" });
  rule("motion_changexby", "motion_xchange", { DX: "DX" });
  rule("motion_setx", "motion_xset", { X: "X" });
  rule("motion_changeyby", "motion_ychange", { DY: "DY" });
  rule("motion_sety", "motion_yset", { Y: "Y" });
  rule("motion_ifonedgebounce", "motion_bounce");
  rule("motion_xposition", "motion_xpos");
  rule("motion_yposition", "motion_ypos");
  rule("motion_direction", "motion_dir");

  rule("looks_say", "looks_say", { M: "MESSAGE" });
  rule("looks_sayforsecs", "looks_sayfor", { M: "MESSAGE", SECS: "SECS" });
  rule("looks_think", "looks_think", { M: "MESSAGE" });
  rule("looks_thinkforsecs", "looks_thinkfor", { M: "MESSAGE", SECS: "SECS" });
  rule("looks_show", "looks_show");
  rule("looks_hide", "looks_hide");
  rule("looks_switchcostumeto", "looks_switchcostume", { C: "COSTUME" });
  rule("looks_nextcostume", "looks_nextcostume");
  rule("looks_changesizeby", "looks_changesize", { S: "CHANGE" });
  rule("looks_setsizeto", "looks_setsize", { S: "SIZE" });
  rule("looks_size", "sense_size");
  rule("looks_changeeffectby", "looks_fxchange", { E: "@EFFECT", V: "CHANGE" });
  rule("looks_seteffectto", "looks_fxset", { E: "@EFFECT", V: "VALUE" });
  rule("looks_cleargraphiceffects", "looks_fxclear");
  rule("looks_goforwardbackwardlayers", "looks_layer", { D: "@FORWARD_BACKWARD", N: "NUM" });

  rule("control_wait", "control_wait", { SECS: "DURATION" });
  rule("control_repeat", "control_repeat", { TIMES: "TIMES" });
  rule("control_forever", "control_forever");
  rule("control_if", "control_if", { COND: "CONDITION" });
  rule("control_if_else", "control_ifelse", { COND: "CONDITION" });
  rule("control_wait_until", "control_waituntil", { COND: "CONDITION" });
  rule("control_repeat_until", "control_repeatuntil", { COND: "CONDITION" });
  rule("control_start_as_clone", "control_startasclone");
  rule("control_create_clone_of", "control_clone", { T: "CLONE_OPTION" });
  rule("control_delete_this_clone", "control_deleteclone");

  rule("sensing_touchingobject", "sense_touching", { T: "TOUCHINGOBJECTMENU" });
  rule("sensing_touchingcolor", "sense_touchcolor", { C: "COLOR" });
  rule("sensing_coloristouchingcolor", "sense_colortouch", { C: "COLOR", D: "COLOR2" });
  rule("sensing_distanceto", "sense_distance", { T: "DISTANCETOMENU" });
  rule("sensing_askandwait", "sense_ask", { Q: "QUESTION" });
  rule("sensing_answer", "sense_answer");
  rule("sensing_keypressed", "sense_keypressed", { KEY: "KEY_OPTION" });
  rule("sensing_mousedown", "sense_mousedown");
  rule("sensing_mousex", "sense_mousex");
  rule("sensing_mousey", "sense_mousey");
  rule("sensing_setdragmode", "sense_setdrag", { M: "@DRAG_MODE" });
  rule("sensing_timer", "sense_timer");
  rule("sensing_resettimer", "sense_resettimer");
  rule("sensing_current", "sense_current", { U: "@CURRENTMENU" });
  rule("sensing_dayssince2000", "sense_days2000");
  rule("sensing_username", "sense_username");

  for (const [name, op] of Object.entries({
    add: "add",
    subtract: "sub",
    multiply: "mul",
    divide: "div",
    mod: "mod",
  }))
    rule("operator_" + name, "op_" + op, { A: "NUM1", B: "NUM2" });
  for (const op of ["gt", "lt", "equals"])
    rule("operator_" + op, "op_" + (op === "equals" ? "eq" : op), { A: "OPERAND1", B: "OPERAND2" });
  for (const op of ["and", "or"])
    rule("operator_" + op, "op_" + op, { A: "OPERAND1", B: "OPERAND2" });
  rule("operator_not", "op_not", { A: "OPERAND" });
  rule("operator_random", "op_random", { A: "FROM", B: "TO" });
  rule("operator_join", "op_join", { A: "STRING1", B: "STRING2" });
  rule("operator_letter_of", "op_letter", { A: "LETTER", B: "STRING" });
  rule("operator_length", "op_length", { A: "STRING" });
  rule("operator_contains", "op_contains", { A: "STRING1", B: "STRING2" });
  rule("operator_round", "op_round", { A: "NUM" });
  rule("operator_mathop", "op_mathop", { OP: "@OPERATOR", A: "NUM" });

  rule("data_variable", "var_get", { VAR: "@VARIABLE" });
  rule("data_setvariableto", "var_set", { VAR: "@VARIABLE", V: "VALUE" });
  rule("data_changevariableby", "var_change", { VAR: "@VARIABLE", V: "VALUE" });
  rule("data_showvariable", "var_show", { VAR: "@VARIABLE" });
  rule("data_hidevariable", "var_hide", { VAR: "@VARIABLE" });
  rule("data_listcontents", "list_get", { L: "@LIST" });
  rule("data_addtolist", "list_add", { L: "@LIST", V: "ITEM" });
  rule("data_deleteoflist", "list_delete", { L: "@LIST", I: "INDEX" });
  rule("data_deletealloflist", "list_deleteall", { L: "@LIST" });
  rule("data_insertatlist", "list_insert", { L: "@LIST", I: "INDEX", V: "ITEM" });
  rule("data_replaceitemoflist", "list_replace", { L: "@LIST", I: "INDEX", V: "ITEM" });
  rule("data_itemoflist", "list_item", { L: "@LIST", I: "INDEX" });
  rule("data_itemnumoflist", "list_indexof", { L: "@LIST", V: "ITEM" });
  rule("data_lengthoflist", "list_length", { L: "@LIST" });
  rule("data_listcontainsitem", "list_contains", { L: "@LIST", V: "ITEM" });
  rule("data_showlist", "list_show", { L: "@LIST" });
  rule("data_hidelist", "list_hide", { L: "@LIST" });

  for (const [scratch, editor] of Object.entries({
    clear: "clear",
    stamp: "stamp",
    penDown: "down",
    penUp: "up",
  }))
    rule("pen_" + scratch, "pen_" + editor);
  rule("pen_setPenColorToColor", "pen_setcolor", { C: "COLOR" });
  rule("pen_changePenColorParamBy", "pen_change", { P: "COLOR_PARAM", V: "VALUE" });
  rule("pen_setPenColorParamTo", "pen_set", { P: "COLOR_PARAM", V: "VALUE" });
  rule("pen_changePenSizeBy", "pen_changesize", { V: "SIZE" });
  rule("pen_setPenSizeTo", "pen_setsize", { V: "SIZE" });

  function scope(definitions, destination, reserved = []) {
    const ids = new Map(),
      used = new Set([
        ...Object.getOwnPropertyNames(Object.prototype),
        ...Object.keys(destination),
        ...reserved,
      ]);
    for (const [id, entry] of Object.entries(definitions || {})) {
      if (!Array.isArray(entry)) continue;
      const label = String(entry[0] || "変数");
      let name = label,
        n = 2;
      while (used.has(name)) name = label + " (" + n++ + ")";
      used.add(name);
      ids.set(id, name);
      Object.defineProperty(destination, name, {
        value: copy(entry[1] ?? 0),
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
    return ids;
  }

  global.ScratchProgramImport = {
    rules,
    scope,
    convert(target, options) {
      const registry = options.registry,
        makeId = options.makeId;
      const graph = target.blocks && typeof target.blocks === "object" ? target.blocks : {};
      const warnings = new Set(),
        vars = Object.create(null),
        lists = Object.create(null);
      const globalVars = options.globalVars,
        globalLists = options.globalLists;
      // Sprite archives omit stage-owned declarations. Discover referenced globals before
      // allocating local names so identical global/local labels cannot alias at runtime.
      function discover(field, isList) {
        if (!Array.isArray(field) || !field[1]) return;
        const [label, id] = field,
          definitions = isList ? target.lists : target.variables;
        const ids = isList ? options.globalListIds : options.globalVarIds;
        if (own(definitions, id) || ids.has(id)) return;
        const destination = isList ? globalLists : globalVars;
        let name = String(label || id);
        if (Object.getOwnPropertyNames(Object.prototype).includes(name)) name += " (Scratch)";
        if (!own(destination, name))
          Object.defineProperty(destination, name, {
            value: isList ? [] : 0,
            writable: true,
            enumerable: true,
            configurable: true,
          });
        ids.set(id, name);
      }
      function discoverInput(raw) {
        if (!Array.isArray(raw)) return;
        if (raw[0] === 12 || raw[0] === 13) discover(raw.slice(1), raw[0] === 13);
        else raw.forEach(discoverInput);
      }
      for (const node of Object.values(graph)) {
        if (!node || Array.isArray(node)) continue;
        discover(node.fields?.VARIABLE, false);
        discover(node.fields?.LIST, true);
        Object.values(node.inputs || {}).forEach(discoverInput);
      }
      const localVars = target.isStage
        ? options.globalVarIds
        : scope(target.variables, vars, Object.keys(globalVars));
      const localLists = target.isStage
        ? options.globalListIds
        : scope(target.lists, lists, Object.keys(globalLists));
      const procedures = new Map(),
        defs = [];
      let count = 0;
      function warn(op) {
        warnings.add(String(op));
      }
      function variable(field, isList) {
        const [label = "", id] = Array.isArray(field) ? field : [field];
        const local = isList ? localLists : localVars;
        const globals = isList ? options.globalListIds : options.globalVarIds;
        if (local.has(id)) return local.get(id);
        if (globals.has(id)) return globals.get(id);
        // .sprite3 can reference a global variable whose definition is not in the archive.
        const destination = isList ? globalLists : globalVars,
          name = String(label || id || "変数");
        if (!own(destination, name))
          Object.defineProperty(destination, name, {
            value: isList ? [] : 0,
            writable: true,
            enumerable: true,
            configurable: true,
          });
        if (id) globals.set(id, name);
        return name;
      }
      function jsonList(value) {
        try {
          const a = JSON.parse(value || "[]");
          return Array.isArray(a) ? a : [];
        } catch {
          warn("procedures: invalid mutation");
          return [];
        }
      }
      // Register every procedure before translating any calls (forward calls and recursion).
      for (const node of Object.values(graph)) {
        if (node?.opcode !== "procedures_definition") continue;
        const ref = node.inputs?.custom_block?.[1],
          prototype = graph[ref];
        const m = prototype?.mutation;
        if (!m?.proccode) {
          warn("procedures_definition");
          continue;
        }
        const names = jsonList(m.argumentnames),
          ids = jsonList(m.argumentids);
        const d = { id: makeId(), items: [], warp: m.warp === "true" || m.warp === true, np: 0 };
        const args = [],
          byName = new Map();
        for (const token of m.proccode.split(/(%[nsb])/g)) {
          if (/^%[nsb]$/.test(token)) {
            const index = d.np++,
              key = "P" + (index + 1);
            d.items.push({
              k: token === "%b" ? "b" : "s",
              id: key,
              n: String(names[index] || "入力"),
            });
            args.push([ids[index], key, token === "%b"]);
            byName.set(names[index], key);
          } else if (token.trim()) d.items.push({ k: "l", t: token.trim() });
        }
        defs.push(d);
        procedures.set(m.proccode, { d, args, byName, root: node });
      }
      function placeholder(node, expected, path, proc) {
        warn(node.opcode || "invalid block");
        const hat =
          node.topLevel && /^(event_when|.*_when|control_start_as)/.test(node.opcode || "");
        const op =
          expected === "b"
            ? "scratch_unsupported_bool"
            : expected === "r"
              ? "scratch_unsupported_value"
              : hat
                ? "scratch_unsupported_hat"
                : "scratch_unsupported";
        const b = { op, in: { OP: String(node.opcode || "invalid block") } };
        if (!expected && !hat)
          b.c = {
            SUB: chain(node.inputs?.SUBSTACK?.[1], path, proc),
            SUB2: chain(node.inputs?.SUBSTACK2?.[1], path, proc),
          };
        return b;
      }
      function primitive(raw, expected, path, proc) {
        if (typeof raw === "string") return block(raw, expected, path, proc);
        if (!Array.isArray(raw)) return expected === "b" ? null : "";
        if (raw[0] === 12) return { op: "var_get", in: { VAR: variable(raw.slice(1), false) } };
        if (raw[0] === 13) return { op: "list_get", in: { L: variable(raw.slice(1), true) } };
        return raw[1] ?? "";
      }
      function input(node, name, expected, path, proc) {
        const raw = node.inputs?.[name];
        if (!Array.isArray(raw)) return expected === "b" ? null : "";
        // Slot 1 is the actual reporter, slot 2 only its obscured shadow/default.
        return primitive(raw[1] ?? raw[2], expected, path, proc);
      }
      function field(node, name) {
        const raw = node.fields?.[name];
        if (name === "VARIABLE" || name === "LIST") return variable(raw, name === "LIST");
        return raw?.[0] ?? "";
      }
      function normalize(key, value) {
        if (typeof value !== "string") return value;
        if (key === "KEY")
          return (
            {
              "up arrow": "up",
              "down arrow": "down",
              "left arrow": "left",
              "right arrow": "right",
            }[value] || value
          );
        if (key === "E")
          return { brightness: "bright" }[value.toLowerCase()] || value.toLowerCase();
        if (key === "D") return value === "forward" ? "f" : value === "backward" ? "b" : value;
        if (key === "W") return value.toLowerCase();
        if (key === "ROT") return { "left-right": "lr", "don't rotate": "none", "all around": "all" }[value] || value;
        if (key === "M" && ["draggable", "not draggable"].includes(value))
          return value === "draggable" ? "1" : "0";
        if (key === "U")
          return (
            {
              DAYOFWEEK: "wday",
              YEAR: "year",
              MONTH: "month",
              DATE: "date",
              HOUR: "hour",
              MINUTE: "min",
              SECOND: "sec",
            }[value] || value
          );
        if (key === "OP") return { ceiling: "ceil", "e ^": "exp", "10 ^": "pow10" }[value] || value;
        return value;
      }
      function block(id, expected, parents = new Set(), proc) {
        const node = graph[id];
        if (
          !node ||
          typeof node.opcode !== "string" ||
          parents.has(id) ||
          parents.size > 30 ||
          ++count > 6000
        ) {
          return placeholder(
            { opcode: "invalid/cyclic/oversized block graph" },
            expected,
            new Set(),
            proc,
          );
        }
        const path = new Set(parents);
        path.add(id);
        const opcode = node.opcode;
        if (node.shadow && !rules[opcode]) {
          const f = Object.values(node.fields || {})[0];
          if (Array.isArray(f)) return f[0];
        }
        if (opcode === "procedures_definition") {
          const p = [...procedures.values()].find((p) => p.root === node);
          return p ? { op: "pd:" + p.d.id, in: {} } : placeholder(node, expected, path, proc);
        }
        if (opcode === "procedures_call") {
          const p = procedures.get(node.mutation?.proccode);
          if (!p) return placeholder(node, expected, path, proc);
          const b = { op: "pc:" + p.d.id, in: {} };
          for (const [id, key, bool] of p.args)
            b.in[key] = input(node, id, bool ? "b" : "r", path, proc);
          return b;
        }
        if (
          opcode === "argument_reporter_string_number" ||
          opcode === "argument_reporter_boolean"
        ) {
          const key = proc?.byName.get(field(node, "VALUE"));
          return key
            ? {
                op: opcode.endsWith("boolean") ? "proc_argb" : "proc_arg",
                in: { D: proc.d.id, P: key },
              }
            : expected === null || expected === undefined
              ? null
              : (warn("引数 " + field(node, "VALUE") + " は定義にないため0として扱います"),
                expected === "b" ? null : 0);
        }
        if (opcode === "control_stop") {
          const which = field(node, "STOP_OPTION");
          const op = {
            all: "control_stopall",
            "this script": "control_stopthis",
            "other scripts in sprite": "control_stopother",
            "other scripts in stage": "control_stopother",
          }[which];
          return op ? { op, in: {} } : placeholder(node, expected, path, proc);
        }
        if (opcode === "looks_gotofrontback")
          return {
            op: field(node, "FRONT_BACK") === "front" ? "looks_front" : "looks_back",
            in: {},
          };
        if (opcode === "looks_costumenumbername")
          return {
            op: field(node, "NUMBER_NAME") === "name" ? "looks_costumename" : "looks_costumenum",
            in: {},
          };
        if (
          opcode === "sensing_touchingobject" &&
          input(node, "TOUCHINGOBJECTMENU", "r", path, proc) === "_edge_"
        )
          return { op: "sense_touchingedge", in: {} };
        if (
          opcode === "event_whengreaterthan" &&
          !["timer", "loudness"].includes(field(node, "WHENGREATERTHANMENU").toLowerCase())
        )
          return placeholder(node, expected, path, proc);
        if (
          opcode === "operator_mathop" &&
          !["abs", "floor", "ceiling", "sqrt", "sin", "cos", "tan", "asin", "acos", "atan", "ln", "log", "e ^", "10 ^"].includes(field(node, "OPERATOR"))
        )
          return placeholder(node, expected, path, proc);
        let spec = rules[opcode];
        if (!spec) {
          const found = Object.entries(registry).find(([, d]) => d.ex?.full === opcode);
          if (found) {
            const [output, d] = found,
              args = {};
            for (const [key, name] of d.ex.keys)
              args[key] = own(node.fields, name) ? "@" + name : name;
            spec = { output, args };
          }
        }
        const d = spec && registry[spec.output];
        if (!d) return placeholder(node, expected, path, proc);
        const b = { op: spec.output, in: {} };
        for (const [dest, source] of Object.entries(spec.args)) {
          const type = d.inp[dest]?.[0] === "b" ? "b" : "r";
          b.in[dest] = normalize(
            dest,
            source[0] === "@"
              ? field(node, source.slice(1))
              : input(node, source, type, path, proc),
          );
          if (dest === "T" && typeof b.in[dest] === "string") {
            b.in[dest] = options.targetNames?.get(b.in[dest]) || b.in[dest];
          }
        }
        if (d.subs?.length) {
          b.c = {};
          d.subs.forEach((key, i) => {
            b.c[key] = chain(node.inputs?.["SUBSTACK" + (i ? i + 1 : "")]?.[1], path, proc);
          });
        }
        return b;
      }
      function chain(first, parents = new Set(), proc) {
        const out = [],
          path = new Set(parents);
        let id = first;
        while (typeof id === "string" && id) {
          if (path.has(id) || count > 6000) {
            out.push(placeholder({ opcode: "cyclic/oversized next chain" }, null, new Set(), proc));
            break;
          }
          const node = graph[id];
          if (!node) {
            warn("missing block: " + id);
            break;
          }
          const b = block(id, null, parents, proc);
          if (b && typeof b === "object" && !Array.isArray(b)) out.push(b);
          else if (!/^argument_reporter/.test(node.opcode)) warn(node.opcode);
          path.add(id);
          id = node.next;
        }
        return out;
      }
      const scripts = Object.entries(graph)
        .filter(([, n]) => n && !Array.isArray(n) && n.topLevel && !n.shadow)
        .sort(
          ([, a], [, b]) =>
            (Number(a.y) || 0) - (Number(b.y) || 0) || (Number(a.x) || 0) - (Number(b.x) || 0),
        )
        .slice(0, 300)
        .map(([id, node]) => {
          const proc = [...procedures.values()].find((p) => p.root === node);
          return {
            id: makeId(),
            x: Math.max(0, Math.min(1e5, Number(node.x) || 20)),
            y: Math.max(0, Math.min(1e5, Number(node.y) || 20)),
            b: chain(id, new Set(), proc),
          };
        })
        .filter((s) => s.b.length);
      return { scripts, defs, vars, lists, warnings: [...warnings] };
    },
  };
})(window);

/* -------- 3) PaintEditorのブロック → Scratch 3 のブロックJSON(.sb3 / .sprite3 の書き出し用) --------
 * 読み込みの変換表(rules)を逆向きに使います。拡張機能のブロックは「拡張機能ID_opcode」で書き出し、
 * 使った拡張機能は project.json の extensions / extensionURLs に入れます。
 */
(function (global) {
  "use strict";
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
  const M = (menu, field) => ({ menu, field });
  const SPEC = {
    motion_movesteps: { STEPS: 4 }, motion_turnright: { DEGREES: 4 }, motion_turnleft: { DEGREES: 4 },
    motion_gotoxy: { X: 4, Y: 4 }, motion_goto: { TO: M("motion_goto_menu", "TO") },
    motion_glidesecstoxy: { SECS: 4, X: 4, Y: 4 }, motion_glideto: { SECS: 4, TO: M("motion_glideto_menu", "TO") },
    motion_pointindirection: { DIRECTION: 8 }, motion_pointtowards: { TOWARDS: M("motion_pointtowards_menu", "TOWARDS") },
    motion_changexby: { DX: 4 }, motion_setx: { X: 4 }, motion_changeyby: { DY: 4 }, motion_sety: { Y: 4 },
    looks_say: { MESSAGE: 10 }, looks_sayforsecs: { MESSAGE: 10, SECS: 4 }, looks_think: { MESSAGE: 10 }, looks_thinkforsecs: { MESSAGE: 10, SECS: 4 },
    looks_switchcostumeto: { COSTUME: M("looks_costume", "COSTUME") }, looks_changesizeby: { CHANGE: 4 }, looks_setsizeto: { SIZE: 4 },
    looks_changeeffectby: { CHANGE: 4 }, looks_seteffectto: { VALUE: 4 }, looks_goforwardbackwardlayers: { NUM: 7 },
    looks_switchbackdropto: { BACKDROP: M("looks_backdrops", "BACKDROP") }, looks_switchbackdroptoandwait: { BACKDROP: M("looks_backdrops", "BACKDROP") },
    sound_play: { SOUND_MENU: M("sound_sounds_menu", "SOUND_MENU") }, sound_playuntildone: { SOUND_MENU: M("sound_sounds_menu", "SOUND_MENU") },
    sound_setvolumeto: { VOLUME: 4 }, sound_changevolumeby: { VOLUME: 4 }, sound_seteffectto: { VALUE: 4 }, sound_changeeffectby: { VALUE: 4 },
    event_broadcast: { BROADCAST_INPUT: "B" }, event_broadcastandwait: { BROADCAST_INPUT: "B" }, event_whengreaterthan: { VALUE: 4 },
    control_wait: { DURATION: 5 }, control_repeat: { TIMES: 6 }, control_if: { CONDITION: "b" }, control_if_else: { CONDITION: "b" },
    control_wait_until: { CONDITION: "b" }, control_repeat_until: { CONDITION: "b" },
    control_create_clone_of: { CLONE_OPTION: M("control_create_clone_of_menu", "CLONE_OPTION") },
    sensing_touchingobject: { TOUCHINGOBJECTMENU: M("sensing_touchingobjectmenu", "TOUCHINGOBJECTMENU") },
    sensing_touchingcolor: { COLOR: 9 }, sensing_coloristouchingcolor: { COLOR: 9, COLOR2: 9 },
    sensing_distanceto: { DISTANCETOMENU: M("sensing_distancetomenu", "DISTANCETOMENU") }, sensing_askandwait: { QUESTION: 10 },
    sensing_keypressed: { KEY_OPTION: M("sensing_keyoptions", "KEY_OPTION") },
    sensing_of: { OBJECT: M("sensing_of_object_menu", "OBJECT") },
    operator_add: { NUM1: 4, NUM2: 4 }, operator_subtract: { NUM1: 4, NUM2: 4 }, operator_multiply: { NUM1: 4, NUM2: 4 },
    operator_divide: { NUM1: 4, NUM2: 4 }, operator_mod: { NUM1: 4, NUM2: 4 },
    operator_gt: { OPERAND1: 10, OPERAND2: 10 }, operator_lt: { OPERAND1: 10, OPERAND2: 10 }, operator_equals: { OPERAND1: 10, OPERAND2: 10 },
    operator_and: { OPERAND1: "b", OPERAND2: "b" }, operator_or: { OPERAND1: "b", OPERAND2: "b" }, operator_not: { OPERAND: "b" },
    operator_random: { FROM: 4, TO: 4 }, operator_join: { STRING1: 10, STRING2: 10 }, operator_letter_of: { LETTER: 6, STRING: 10 },
    operator_length: { STRING: 10 }, operator_contains: { STRING1: 10, STRING2: 10 }, operator_round: { NUM: 4 }, operator_mathop: { NUM: 4 },
    data_setvariableto: { VALUE: 10 }, data_changevariableby: { VALUE: 4 }, data_addtolist: { ITEM: 10 }, data_deleteoflist: { INDEX: 7 },
    data_insertatlist: { INDEX: 7, ITEM: 10 }, data_replaceitemoflist: { INDEX: 7, ITEM: 10 }, data_itemoflist: { INDEX: 7 },
    data_itemnumoflist: { ITEM: 10 }, data_listcontainsitem: { ITEM: 10 },
    pen_setPenColorToColor: { COLOR: 9 }, pen_changePenColorParamBy: { COLOR_PARAM: M("pen_menu_colorParam", "colorParam"), VALUE: 4 },
    pen_setPenColorParamTo: { COLOR_PARAM: M("pen_menu_colorParam", "colorParam"), VALUE: 4 }, pen_changePenSizeBy: { SIZE: 4 }, pen_setPenSizeTo: { SIZE: 4 },
    music_setTempo: { TEMPO: 4 }, music_changeTempo: { TEMPO: 4 },
    stretch_setStretchX: { X: 4 }, stretch_setStretchY: { Y: 4 }, stretch_changeStretch: { DX: 4, DY: 4 },
  };
  const SUBS = ["SUBSTACK", "SUBSTACK2"];
  const KEYNAMES = { up: "up arrow", down: "down arrow", left: "left arrow", right: "right arrow" };
  const PROPS = { x: "x position", y: "y position", dir: "direction", cn: "costume #", cname: "costume name", size: "size" };
  const PENP = { h: "color", s: "saturation", b: "brightness", a: "transparency" };
  const CUR = { wday: "DAYOFWEEK", year: "YEAR", month: "MONTH", date: "DATE", hour: "HOUR", min: "MINUTE", sec: "SECOND" };
  const isBlock = (v) => v && typeof v === "object" && !Array.isArray(v) && typeof v.op === "string";
  const str = (v) => (v == null ? "" : String(v));

  /* PaintEditorの値 → Scratchの欄の値 (読み込みの normalize の逆) */
  function denorm(key, value, opcode) {
    if (typeof value !== "string") return value;
    if (key === "KEY") return KEYNAMES[value] || value;
    if (key === "E") return opcode.startsWith("looks_") ? ({ bright: "BRIGHTNESS" }[value] || value.toUpperCase()) : value.toUpperCase();
    if (key === "D") return value === "f" ? "forward" : value === "b" ? "backward" : value;
    if (key === "W") return value.toUpperCase();
    if (key === "ROT") return { lr: "left-right", none: "don't rotate", all: "all around" }[value] || value;
    if (key === "M" && opcode === "sensing_setdragmode") return value === "1" ? "draggable" : "not draggable";
    if (key === "U") return CUR[value] || value;
    if (key === "OP") return { ceil: "ceiling", exp: "e ^", pow10: "10 ^" }[value] || value;
    if (key === "P" && own(PENP, value)) return PENP[value];
    return value;
  }

  global.ScratchProgramExport = {
    /* spec: {key,isStage,name,scripts,vars,lists}
       ctx: {registry, defs(Map id→def), defScripts(Map id→script), names(Map), gVar(name)→id, gList(name)→id, bcast(name)→id,
             globalsAsLocal, gvals, glists, extInfo(ext)→{id,url}} */
    build(spec, ctx) {
      const blocks = {}, warn = new Set(), exts = new Set(), variables = {}, lists = {}, calledDefs = new Set(), doneDefs = new Set();
      let seq = 0;
      const nid = () => spec.key + "." + (++seq).toString(36);
      const rules = (global.ScratchProgramImport && global.ScratchProgramImport.rules) || {};
      const inv = Object.create(null);
      for (const [input, r] of Object.entries(rules)) if (!inv[r.output]) inv[r.output] = { opcode: input, args: r.args };
      inv.event_whenclicked = { opcode: spec.isStage ? "event_whenstageclicked" : "event_whenthisspriteclicked", args: {} };
      const lv = new Map(), ll = new Map();
      const localVar = (name, value, isList) => {
        const m = isList ? ll : lv, dst = isList ? lists : variables;
        if (m.has(name)) return m.get(name);
        const id = spec.key + (isList ? ".l." : ".v.") + m.size;
        m.set(name, id); dst[id] = [name, value];
        return id;
      };
      for (const [k, v] of Object.entries(spec.vars || {})) localVar(k, v, false);
      for (const [k, v] of Object.entries(spec.lists || {})) localVar(k, Array.isArray(v) ? v : [], true);
      const varId = (name, isList) => {
        name = str(name);
        const m = isList ? ll : lv;
        if (m.has(name)) return m.get(name);
        if (ctx.globalsAsLocal) return localVar(name, isList ? (ctx.glists && ctx.glists[name]) || [] : ctx.gvals && own(ctx.gvals, name) ? ctx.gvals[name] : 0, isList);
        return isList ? ctx.gList(name) : ctx.gVar(name);
      };
      const tname = (v) => (typeof v === "string" && ctx.names.has(v) ? ctx.names.get(v) : v);
      const mkBlock = (opcode, parent, extra) => {
        const id = nid();
        blocks[id] = Object.assign({ opcode, next: null, parent: parent || null, inputs: {}, fields: {}, shadow: false, topLevel: false }, extra || {});
        return id;
      };
      const menuShadow = (parent, menu, value) => {
        const id = nid();
        blocks[id] = { opcode: menu.menu, next: null, parent, inputs: {}, fields: { [menu.field]: [str(value), null] }, shadow: true, topLevel: false };
        return id;
      };
      /* 1つの入力欄 */
      function input(opcode, name, val, parent, forced) {
        const t = forced !== undefined ? forced : (SPEC[opcode] && SPEC[opcode][name]) !== undefined ? SPEC[opcode][name] : 10;
        if (t === "b") return isBlock(val) ? [2, value(val, parent)] : null;
        if (t === "B") {
          if (isBlock(val)) return [3, value(val, parent), [11, "message1", ctx.bcast("message1")]];
          const nm = str(val) || "message1";
          return [1, [11, nm, ctx.bcast(nm)]];
        }
        if (t && typeof t === "object") {
          if (isBlock(val)) return [3, value(val, parent), menuShadow(parent, t, "")];
          return [1, menuShadow(parent, t, tname(val))];
        }
        if (isBlock(val)) {
          if (val.op === "var_get") return [3, [12, str(val.in && val.in.VAR), varId(val.in && val.in.VAR, false)], [t, ""]];
          if (val.op === "list_get") return [3, [13, str(val.in && val.in.L), varId(val.in && val.in.L, true)], [t, ""]];
          return [3, value(val, parent), [t, ""]];
        }
        return [1, [t, str(val)]];
      }
      /* 値ブロック(丸・六角) → ブロックID */
      function value(b, parent) {
        const ids = lowerBlock(b, parent, false);
        return ids[0];
      }
      function fieldValue(peKey, val, opcode, name) {
        if (name === "VARIABLE") return [str(val), varId(val, false)];
        if (name === "LIST") return [str(val), varId(val, true)];
        if (name === "BROADCAST_OPTION") return [str(val), ctx.bcast(str(val))];
        return [str(denorm(peKey, isBlock(val) ? "" : val, opcode)), null];
      }
      function extBlock(b, d, parent, top) {
        const X = d.ex, ext = X.ext, info = ext.inst.getInfo(), meta = ctx.extInfo(ext);
        exts.add(meta.id);
        const bi = (info.blocks || []).find((x) => x && x.opcode === X.opc) || {};
        const opcode = meta.id + "_" + X.opc, id = mkBlock(opcode, parent, { topLevel: !!top });
        const B = blocks[id], menus = info.menus || {};
        for (const [k, argName, ty] of X.keys) {
          const a = (bi.arguments || {})[argName] || {}, val = b.in && b.in[k];
          let menuName = a.menu != null && menus[a.menu] !== undefined ? a.menu : null;
          if (menuName) {
            const m = menus[menuName], acc = m && !Array.isArray(m) && m.acceptReporters;
            if (acc) {
              const sh = { menu: meta.id + "_menu_" + menuName, field: menuName };
              B.inputs[argName] = isBlock(val) ? [3, value(val, id), menuShadow(id, sh, "")] : [1, menuShadow(id, sh, str(val))];
            } else B.fields[argName] = [str(val), null];
            continue;
          }
          if (ty === "Boolean") { if (isBlock(val)) B.inputs[argName] = [2, value(val, id)]; continue }
          const code = ty === "number" ? 4 : ty === "angle" ? 8 : ty === "color" ? 9 : 10;
          B.inputs[argName] = input(opcode, argName, val, id, code);
        }
        const nsub = X.ext && bi.branchCount != null ? Math.floor(bi.branchCount) : 1;
        if (b.c) SUBS.forEach((s, i) => { const key = i ? "SUB2" : "SUB"; if (b.c[key] && (b.c[key].length || i < Math.max(1, nsub))) { const f = chain(b.c[key], id); if (f) B.inputs[s] = [2, f] } });
        return [id];
      }
      /* PaintEditorのブロック1つ → Scratchのブロック(複数になることがある)のID配列。先頭が本体 */
      function lowerBlock(b, parent, top) {
        const op = b.op, d = ctx.registry[op], inn = b.in || {};
        if (typeof op === "string" && op.startsWith("pc:")) return [callBlock(b, parent, top)];
        if (typeof op === "string" && op.startsWith("pd:")) return [mkBlock("procedures_definition", parent, { topLevel: !!top })];
        if (op === "var_get") { const id = mkBlock("data_variable", parent, { topLevel: !!top }); blocks[id].fields.VARIABLE = [str(inn.VAR), varId(inn.VAR, false)]; return [id] }
        if (op === "list_get") { const id = mkBlock("data_listcontents", parent, { topLevel: !!top }); blocks[id].fields.LIST = [str(inn.L), varId(inn.L, true)]; return [id] }
        if (op === "proc_arg" || op === "proc_argb") {
          const def = ctx.defs.get(inn.D), it = def && def.items.find((x) => x.id === inn.P);
          const id = mkBlock(op === "proc_argb" ? "argument_reporter_boolean" : "argument_reporter_string_number", parent, { topLevel: !!top });
          blocks[id].fields.VALUE = [it ? str(it.n) : "入力", null]; return [id];
        }
        if (d && d.ex) return extBlock(b, d, parent, top);
        const simple = (opcode, fields, ins, extra) => {
          const id = mkBlock(opcode, parent, Object.assign({ topLevel: !!top }, extra || {}));
          Object.entries(fields || {}).forEach(([k, v]) => (blocks[id].fields[k] = v));
          Object.entries(ins || {}).forEach(([k, v]) => { const r = input(opcode, k, v, id); if (r) blocks[id].inputs[k] = r });
          return [id];
        };
        switch (op) {
          case "looks_setghost": return simple("looks_seteffectto", { EFFECT: ["GHOST", null] }, { VALUE: inn.V });
          case "looks_changeghost": return simple("looks_changeeffectby", { EFFECT: ["GHOST", null] }, { CHANGE: inn.V });
          case "looks_front": return simple("looks_gotofrontback", { FRONT_BACK: ["front", null] });
          case "looks_back": return simple("looks_gotofrontback", { FRONT_BACK: ["back", null] });
          case "looks_costumenum": return simple("looks_costumenumbername", { NUMBER_NAME: ["number", null] });
          case "looks_costumename": return simple("looks_costumenumbername", { NUMBER_NAME: ["name", null] });
          case "control_stopall": return simple("control_stop", { STOP_OPTION: ["all", null] }, null, { mutation: { tagName: "mutation", children: [], hasnext: "false" } });
          case "control_stopthis": return simple("control_stop", { STOP_OPTION: ["this script", null] }, null, { mutation: { tagName: "mutation", children: [], hasnext: "false" } });
          case "control_stopother": return simple("control_stop", { STOP_OPTION: ["other scripts in sprite", null] }, null, { mutation: { tagName: "mutation", children: [], hasnext: "true" } });
          case "sense_touchingedge": return simple("sensing_touchingobject", null, { TOUCHINGOBJECTMENU: "_edge_" });
          case "sense_x": case "sense_y": case "sense_dir": {
            const id = simple("sensing_of", { PROPERTY: [PROPS[op.slice(6)], null] }, { OBJECT: spec.isStage ? "_stage_" : ctx.names.get(spec.name) || spec.name });
            return id;
          }
          case "sense_of": return simple("sensing_of", { PROPERTY: [PROPS[inn.P] || str(inn.P), null] }, { OBJECT: inn.T === "__stage__" ? "_stage_" : inn.T });
          case "sense_visible": warn.add("「表示されている」はScratchにないため書き出せません"); return simple("operator_not", null, { OPERAND: null });
          case "looks_setstretch": return lowerBlock({ op: "looks_setstretchx", in: { X: inn.X } }, parent, top).concat(lowerBlock({ op: "looks_setstretchy", in: { Y: inn.Y } }, parent, false));
          case "looks_setstretchx": exts.add("stretch"); return simple("stretch_setStretchX", null, { X: inn.X });
          case "looks_setstretchy": exts.add("stretch"); return simple("stretch_setStretchY", null, { Y: inn.Y });
          case "looks_changestretch": exts.add("stretch"); return simple("stretch_changeStretch", null, { DX: inn.X, DY: inn.Y });
          case "looks_stretchx": exts.add("stretch"); return simple("stretch_getX");
          case "looks_stretchy": exts.add("stretch"); return simple("stretch_getY");
        }
        if (/^scratch_unsupported/.test(op)) {
          warn.add("未対応ブロック " + str(inn.OP) + " は中身なしで書き出しました");
          const id = mkBlock(str(inn.OP) || "motion_movesteps", parent, { topLevel: !!top });
          if (b.c) SUBS.forEach((s, i) => { const f = chain(b.c[i ? "SUB2" : "SUB"] || [], id); if (f) blocks[id].inputs[s] = [2, f] });
          return [id];
        }
        const r = inv[op];
        if (!r) { warn.add("Scratchに対応するブロックがないため省きました: " + op); return [] }
        const opcode = r.opcode, id = mkBlock(opcode, parent, { topLevel: !!top });
        if (/^pen_/.test(opcode)) exts.add("pen");
        if (/^music_/.test(opcode)) exts.add("music");
        const B = blocks[id];
        for (const [peKey, source] of Object.entries(r.args || {})) {
          const val = inn[peKey];
          if (source[0] === "@") B.fields[source.slice(1)] = fieldValue(peKey, val, opcode, source.slice(1));
          else {
            let v = val;
            if (["T"].includes(peKey) || (peKey === "T" && typeof v === "string")) v = tname(v);
            if (opcode === "sensing_touchingobject" && v === "_edge_") v = "_edge_";
            if (peKey === "P" && own(PENP, v)) v = PENP[v];
            else if (peKey === "KEY") v = denorm("KEY", v, opcode);
            const rr = input(opcode, source, v, id);
            if (rr) B.inputs[source] = rr;
          }
        }
        if (d && d.subs && d.subs.length) d.subs.forEach((k, i) => { const f = chain((b.c && b.c[k]) || [], id); if (f) B.inputs[SUBS[i]] = [2, f] });
        return [id];
      }
      function callBlock(b, parent, top) {
        const did = b.op.slice(3), def = ctx.defs.get(did);
        if (!def) { warn.add("定義が見つからない呼び出しを省きました"); return mkBlock("motion_movesteps", parent, { topLevel: !!top }) }
        calledDefs.add(did);
        const id = mkBlock("procedures_call", parent, { topLevel: !!top });
        const args = def.items.filter((x) => x.k === "s" || x.k === "b");
        blocks[id].mutation = { tagName: "mutation", children: [], proccode: proccode(def), argumentids: JSON.stringify(args.map((a) => argId(did, a.id))), warp: String(!!def.warp) };
        for (const a of args) {
          const v = b.in && b.in[a.id], aid = argId(did, a.id);
          if (a.k === "b") { if (isBlock(v)) blocks[id].inputs[aid] = [2, value(v, id)] }
          else blocks[id].inputs[aid] = input("procedures_call", aid, v, id, 10);
        }
        return id;
      }
      const argId = (did, key) => "pearg-" + did + "-" + key;
      const proccode = (def) => def.items.map((x) => (x.k === "l" ? str(x.t) : x.k === "b" ? "%b" : "%s")).join(" ");
      /* ブロックの列 → 'next' でつなぐ。先頭のIDを返す */
      function chain(list, parent, top) {
        let first = null, prev = null;
        for (const b of list || []) {
          if (!isBlock(b)) continue;
          const ids = lowerBlock(b, prev || parent, top && !prev);
          for (const id of ids) {
            if (!first) first = id;
            if (prev) { blocks[prev].next = id; blocks[id].parent = prev }
            prev = id;
          }
        }
        return first;
      }
      function script(s) {
        const list = (s.b || []).filter(isBlock);
        if (!list.length) return;
        const f = list[0];
        if (typeof f.op === "string" && f.op.startsWith("pd:")) {
          const did = f.op.slice(3), def = ctx.defs.get(did);
          if (!def) return;
          doneDefs.add(did);
          const hat = mkBlock("procedures_definition", null, { topLevel: true, x: Math.round(s.x || 20), y: Math.round(s.y || 20) });
          const proto = mkBlock("procedures_prototype", hat, { shadow: true });
          const args = def.items.filter((x) => x.k === "s" || x.k === "b");
          blocks[proto].mutation = {
            tagName: "mutation", children: [], proccode: proccode(def),
            argumentids: JSON.stringify(args.map((a) => argId(did, a.id))), argumentnames: JSON.stringify(args.map((a) => str(a.n))),
            argumentdefaults: JSON.stringify(args.map((a) => (a.k === "b" ? "false" : ""))), warp: String(!!def.warp),
          };
          for (const a of args) {
            const aid = nid();
            blocks[aid] = { opcode: a.k === "b" ? "argument_reporter_boolean" : "argument_reporter_string_number", next: null, parent: proto, inputs: {}, fields: { VALUE: [str(a.n), null] }, shadow: true, topLevel: false };
            blocks[proto].inputs[argId(did, a.id)] = [1, aid];
          }
          blocks[hat].inputs.custom_block = [1, proto];
          const rest = chain(list.slice(1), hat);
          if (rest) blocks[hat].next = rest;
          return;
        }
        const first = chain(list, null, true);
        if (first) { blocks[first].x = Math.round(s.x || 20); blocks[first].y = Math.round(s.y || 20) }
      }
      for (const s of spec.scripts || []) script(s);
      /* 呼び出している定義ブロックで、このスプライトに本体がないものは、本体を複製して入れる */
      for (let guard = 0; guard < 50; guard++) {
        const need = [...calledDefs].filter((id) => !doneDefs.has(id) && ctx.defScripts.has(id));
        if (!need.length) break;
        need.forEach((id) => script(ctx.defScripts.get(id)));
      }
      return { blocks, variables, lists, warnings: [...warn], exts: [...exts] };
    },
  };
})(window);
