window.__ModuleLoader__.load({
	id: "dsh-plugin-mascot",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let React = require("react");
		let h = React.createElement;

		//#region art — generated from assets/*.svg by scripts/sync-art.mjs
		/* Art is inlined as SVG source so the mascot ships with zero network
		   requests and zero asset-path assumptions. `scripts/sync-art.mjs`
		   rewrites the three constants below from `assets/`. */
		const CLOSURE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -20 340 560" width="340" height="560" role="img" aria-label="Closure mascot">
  <title>可露希尔 · Closure — DSH mascot (original fan art)</title>
  <defs>
    <linearGradient id="cl-hair" x1="0.25" y1="0" x2="0.75" y2="1">
      <stop offset="0" stop-color="#5cc4b2"/>
      <stop offset="0.32" stop-color="#27455a"/>
      <stop offset="1" stop-color="#101827"/>
    </linearGradient>
    <linearGradient id="cl-hair-back" x1="0.5" y1="0" x2="0.5" y2="1">
      <stop offset="0" stop-color="#1c2c40"/>
      <stop offset="0.55" stop-color="#121a2c"/>
      <stop offset="1" stop-color="#0a0f1e"/>
    </linearGradient>
    <linearGradient id="cl-eye" x1="0.5" y1="0" x2="0.5" y2="1">
      <stop offset="0" stop-color="#ff6a6e"/>
      <stop offset="0.42" stop-color="#e02238"/>
      <stop offset="1" stop-color="#7a0f22"/>
    </linearGradient>
    <linearGradient id="cl-skin" x1="0.5" y1="0" x2="0.5" y2="1">
      <stop offset="0" stop-color="#fde8db"/>
      <stop offset="1" stop-color="#f0c5b0"/>
    </linearGradient>
    <linearGradient id="cl-skin-limb" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f8dccd"/>
      <stop offset="1" stop-color="#eec0aa"/>
    </linearGradient>
    <linearGradient id="cl-tee" x1="0.5" y1="0" x2="0.5" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#d5dee8"/>
    </linearGradient>
    <linearGradient id="cl-jacket" x1="0.5" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#2e3441"/>
      <stop offset="0.5" stop-color="#191d26"/>
      <stop offset="1" stop-color="#0b0e15"/>
    </linearGradient>
    <linearGradient id="cl-drone" x1="0.2" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#2b3140"/>
      <stop offset="1" stop-color="#0a0d14"/>
    </linearGradient>
    <radialGradient id="cl-glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#5ff0e4" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#5ff0e4" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <ellipse cx="150" cy="524" rx="80" ry="13" fill="#000" opacity="0.15"/>

  <!-- ================= back hair ================= -->
  <path fill="url(#cl-hair-back)" d="M150 44
    C98 44 68 84 66 136
    C64 184 60 236 56 292
    C54 322 58 348 70 370
    C78 352 83 334 86 316
    C84 354 88 382 99 402
    C108 380 113 354 115 326
    C119 346 126 362 137 374
    C142 344 144 314 144 286 L156 286
    C156 314 158 344 163 374
    C174 362 181 346 185 326
    C187 354 192 380 201 402
    C212 382 216 354 214 316
    C217 334 222 352 230 370
    C242 348 246 322 244 292
    C240 236 236 184 234 136
    C232 84 202 44 150 44 Z"/>

  <!-- ================= drone companion ================= -->
  <g transform="translate(243 60) rotate(-8) scale(0.92)">
    <ellipse cx="0" cy="30" rx="40" ry="22" fill="url(#cl-glow)"/>
    <path fill="#151a24" d="M-44 22 C-56 14 -65 5 -69 -3 C-61 -5 -51 -3 -41 3 Z"/>
    <path fill="#151a24" d="M44 22 C56 14 65 5 69 -3 C61 -5 51 -3 41 3 Z"/>
    <path fill="#26333f" d="M-42 19 C-52 13 -59 6 -63 0 C-55 -2 -47 1 -39 7 Z"/>
    <path fill="#26333f" d="M42 19 C52 13 59 6 63 0 C55 -2 47 1 39 7 Z"/>
    <rect x="-28" y="-6" width="56" height="52" rx="10" fill="url(#cl-drone)" stroke="#3b4351" stroke-width="2"/>
    <rect x="-20" y="1" width="40" height="24" rx="5" fill="#080d12"/>
    <path d="M-20 19 L-6 8 L3 17 L13 5 L20 11" fill="none" stroke="#4fe3d8" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="0" cy="35" r="3" fill="#4fe3d8"/>
    <path d="M2 -6 C4 -15 7 -20 12 -24" fill="none" stroke="#3b4351" stroke-width="2" stroke-linecap="round"/>
    <circle cx="13" cy="-25" r="2.8" fill="#4fe3d8"/>
  </g>

  <!-- ================= legs ================= -->
  <path d="M127 382 L124 458" fill="none" stroke="url(#cl-skin-limb)" stroke-width="30" stroke-linecap="round"/>
  <path d="M173 382 L176 458" fill="none" stroke="url(#cl-skin-limb)" stroke-width="30" stroke-linecap="round"/>
  <path d="M126 414 q-12 3 -14 9" fill="none" stroke="#e3b39f" stroke-width="3" stroke-linecap="round" opacity="0.7"/>
  <path d="M174 414 q12 3 14 9" fill="none" stroke="#e3b39f" stroke-width="3" stroke-linecap="round" opacity="0.7"/>

  <!-- ================= sneakers ================= -->
  <g>
    <path fill="#1b1f27" d="M108 448 L146 448 L148 474 C148 484 140 490 128 490 L106 490 C97 490 93 484 95 474 Z"/>
    <path fill="#e9edf2" d="M92 474 L150 474 C150 485 143 492 130 492 L105 492 C95 492 91 485 92 474 Z"/>
    <path fill="#c8202f" d="M110 454 L144 454 L145 461 L109 461 Z"/>
    <path fill="#3b424e" d="M110 466 L146 466 L146 470 L110 470 Z"/>
    <path fill="#1b1f27" d="M154 448 L192 448 C200 454 204 461 205 468 C205 481 197 490 185 490 L156 490 C152 490 152 479 152 474 Z"/>
    <path fill="#e9edf2" d="M150 474 L208 474 C208 485 200 492 187 492 L156 492 C152 492 150 485 150 474 Z"/>
    <path fill="#c8202f" d="M156 454 L190 454 L192 461 L155 461 Z"/>
    <path fill="#3b424e" d="M154 466 L202 466 L203 470 L154 470 Z"/>
  </g>

  <!-- ================= shorts ================= -->
  <path fill="#14181f" d="M110 356 L190 356 L194 396 C194 404 188 408 180 408 L158 408 L150 384 L142 408 L120 408 C112 408 106 404 106 396 Z"/>
  <path fill="#252b36" d="M110 356 L190 356 L191 366 L109 366 Z"/>

  <!-- ================= torso: oversized tee ================= -->
  <path fill="url(#cl-tee)" d="M150 204
    C120 204 96 216 90 244
    C84 276 82 320 82 360
    C82 368 86 372 94 372
    L206 372
    C214 372 218 368 218 360
    C218 320 216 276 210 244
    C204 216 180 204 150 204 Z"/>
  <path fill="#c6cfda" opacity="0.8" d="M150 204 C134 204 121 208 110 214 C123 210 136 207 150 207 C164 207 177 210 190 214 C179 208 166 204 150 204 Z"/>
  <g transform="translate(150 262)">
    <circle r="28" fill="#14181f"/>
    <circle r="24" fill="none" stroke="#3a4250" stroke-width="1.6"/>
    <path d="M0 -15 C10 -15 17 -6 17 3 C17 13 9 19 0 19 C-9 19 -17 13 -17 3 C-17 -6 -10 -15 0 -15 Z" fill="#f4f6f8"/>
    <path d="M-16 -3 C-25 -7 -31 -14 -35 -22 C-27 -22 -19 -17 -14 -9 Z" fill="#f4f6f8"/>
    <path d="M16 -3 C25 -7 31 -14 35 -22 C27 -22 19 -17 14 -9 Z" fill="#f4f6f8"/>
    <circle cx="-6" cy="2" r="3.6" fill="#14181f"/>
    <circle cx="6" cy="2" r="3.6" fill="#14181f"/>
    <path d="M-5.5 11 L5.5 11 L0 17 Z" fill="#c8202f"/>
  </g>

  <!-- ================= harness / belt ================= -->
  <path fill="#0f1218" d="M88 288 L212 288 L212 306 L88 306 Z"/>
  <rect x="137" y="284" width="26" height="26" rx="6" fill="#c8202f" stroke="#5c0d17" stroke-width="2"/>
  <rect x="144" y="291" width="12" height="12" rx="2" fill="#14181f"/>
  <path fill="#0f1218" d="M104 234 L120 234 L134 300 L118 300 Z" opacity="0.92"/>
  <path fill="#0f1218" d="M196 234 L180 234 L166 300 L182 300 Z" opacity="0.92"/>

  <!-- ================= jacket sleeves + arms ================= -->
  <path d="M106 222 C84 244 72 292 74 344" fill="none" stroke="url(#cl-jacket)" stroke-width="42" stroke-linecap="round"/>
  <path d="M194 222 C216 244 228 292 226 344" fill="none" stroke="url(#cl-jacket)" stroke-width="42" stroke-linecap="round"/>
  <path d="M74 320 C68 304 66 286 68 270" fill="none" stroke="#c8202f" stroke-width="7" stroke-linecap="round" opacity="0.9"/>
  <path d="M226 320 C232 304 234 286 232 270" fill="none" stroke="#c8202f" stroke-width="7" stroke-linecap="round" opacity="0.9"/>
  <circle cx="76" cy="366" r="15" fill="url(#cl-skin)"/>
  <circle cx="224" cy="366" r="15" fill="url(#cl-skin)"/>
  <path d="M62 350 C68 344 84 344 88 350 L90 366 C80 374 68 372 62 364 Z" fill="#0c0f15"/>
  <path d="M238 350 C232 344 216 344 212 350 L210 366 C220 374 232 372 238 364 Z" fill="#0c0f15"/>

  <!-- ================= jacket body ================= -->
  <path fill="url(#cl-jacket)" d="M100 208
    C74 218 58 244 54 276
    C50 310 54 344 62 372
    C80 380 96 372 100 358
    C90 322 88 262 100 208 Z"/>
  <path fill="url(#cl-jacket)" d="M200 208
    C226 218 242 244 246 276
    C250 310 246 344 238 372
    C220 380 204 372 200 358
    C210 322 212 262 200 208 Z"/>
  <path fill="#c8202f" d="M100 208 C86 213 74 224 68 238 C78 228 90 218 104 212 Z"/>
  <path fill="#c8202f" d="M200 208 C214 213 226 224 232 238 C222 228 210 218 196 212 Z"/>
  <path fill="#8f1622" opacity="0.85" d="M100 208 C92 211 84 217 78 225 C86 220 94 215 102 212 Z"/>
  <path fill="#1b202a" d="M114 198 C102 208 96 220 94 234 C106 224 120 212 132 204 Z"/>
  <path fill="#1b202a" d="M186 198 C198 208 204 220 206 234 C194 224 180 212 168 204 Z"/>
  <path d="M58 258 C55 288 58 322 66 356" fill="none" stroke="#37e0d8" stroke-width="2.8" stroke-linecap="round" opacity="0.95"/>
  <path d="M242 258 C245 288 242 322 234 356" fill="none" stroke="#37e0d8" stroke-width="2.8" stroke-linecap="round" opacity="0.95"/>

  <!-- ================= tool pouch + wrench ================= -->
  <g transform="translate(64 330)">
    <rect x="-15" y="-26" width="32" height="50" rx="8" fill="#f2c53d" stroke="#a8801a" stroke-width="2"/>
    <rect x="-9" y="-20" width="20" height="11" rx="3" fill="#a8801a"/>
    <circle cx="1" cy="7" r="5" fill="#a8801a"/>
    <path d="M-2 11 L-2 22 L4 22 L4 11 Z" fill="#a8801a"/>
  </g>
  <path d="M34 352 L54 334" fill="none" stroke="#9aa3b0" stroke-width="7" stroke-linecap="round"/>
  <path d="M30 348 C21 341 21 330 30 326 C35 324 40 326 42 331 L38 337 L42 344 C40 348 35 350 30 348 Z" fill="#e0e5ec"/>

  <!-- ================= neck + choker ================= -->
  <path fill="#e8b9a5" d="M134 176 L166 176 L166 214 L134 214 Z"/>
  <path fill="#0f1218" d="M130 190 L170 190 L170 202 L130 202 Z"/>
  <path fill="#c8202f" d="M150 189 L158 196 L150 204 L142 196 Z"/>
  <circle cx="150" cy="196" r="2.8" fill="#ff9aa1"/>

  <!-- ================= head ================= -->
  <path fill="#f7ddce" d="M99 132 C86 112 68 92 58 84 C52 80 47 84 51 95 C62 118 82 152 99 166 Z"/>
  <path fill="#f7ddce" d="M201 132 C214 112 232 92 242 84 C248 80 253 84 249 95 C238 118 218 152 201 166 Z"/>
  <path fill="#e8b7a4" d="M74 96 C82 110 92 128 99 142 L95 148 C87 132 79 112 72 100 Z"/>
  <path fill="#e8b7a4" d="M226 96 C218 110 208 128 201 142 L205 148 C213 132 221 112 228 100 Z"/>

  <path fill="url(#cl-skin)" d="M150 60 C114 60 94 90 94 130 C94 172 118 202 150 202 C182 202 206 172 206 130 C206 90 186 60 150 60 Z"/>
  <ellipse cx="110" cy="168" rx="14" ry="7.5" fill="#f79a94" opacity="0.45"/>
  <ellipse cx="190" cy="168" rx="14" ry="7.5" fill="#f79a94" opacity="0.45"/>

  <!-- eyes -->
  <g>
    <ellipse cx="123" cy="146" rx="15.5" ry="17.5" fill="#fdf7f4"/>
    <ellipse cx="177" cy="146" rx="15.5" ry="17.5" fill="#fdf7f4"/>
    <ellipse cx="123" cy="147" rx="12" ry="15" fill="url(#cl-eye)"/>
    <ellipse cx="177" cy="147" rx="12" ry="15" fill="url(#cl-eye)"/>
    <ellipse cx="123" cy="149" rx="5" ry="7.6" fill="#2b0611"/>
    <ellipse cx="177" cy="149" rx="5" ry="7.6" fill="#2b0611"/>
    <circle cx="127.5" cy="139" r="4.3" fill="#fff"/>
    <circle cx="181.5" cy="139" r="4.3" fill="#fff"/>
    <circle cx="119" cy="154" r="2.2" fill="#fff" opacity="0.85"/>
    <circle cx="173" cy="154" r="2.2" fill="#fff" opacity="0.85"/>
    <path d="M107 136 C114 124 134 122 140 135" fill="none" stroke="#141821" stroke-width="5.6" stroke-linecap="round"/>
    <path d="M193 136 C186 124 166 122 160 135" fill="none" stroke="#141821" stroke-width="5.6" stroke-linecap="round"/>
    <path d="M108 161 C115 169 131 170 138 163" fill="none" stroke="#141821" stroke-width="2.6" stroke-linecap="round" opacity="0.7"/>
    <path d="M192 161 C185 169 169 170 162 163" fill="none" stroke="#141821" stroke-width="2.6" stroke-linecap="round" opacity="0.7"/>
    <path d="M109 118 C118 111 132 111 139 116" fill="none" stroke="#26334c" stroke-width="4" stroke-linecap="round"/>
    <path d="M191 118 C182 111 168 111 161 116" fill="none" stroke="#26334c" stroke-width="4" stroke-linecap="round"/>
  </g>

  <path d="M141 180 C146 189 154 189 159 180" fill="none" stroke="#a4404a" stroke-width="3" stroke-linecap="round"/>
  <path d="M150 179 L155.5 179 L152.5 188 Z" fill="#fff" stroke="#c98b8b" stroke-width="1"/>

  <!-- ================= front hair ================= -->
  <!-- fringe mass: covers forehead, bottom edge stays above the eyes -->
  <path fill="url(#cl-hair)" d="M76 164
    C70 108 100 58 150 58
    C200 58 230 108 224 164
    C216 138 208 122 198 112
    C186 128 170 136 150 136
    C130 136 114 128 102 112
    C92 122 84 138 76 164 Z"/>
  <!-- face-framing strands (kept clear of the eyes) -->
  <path fill="url(#cl-hair)" d="M102 108 C95 130 91 154 91 178 C86 154 87 128 94 106 Z"/>
  <path fill="url(#cl-hair)" d="M198 108 C205 130 209 154 209 178 C214 154 213 128 206 106 Z"/>
  <!-- side locks -->
  <path fill="url(#cl-hair)" d="M90 120 C84 156 81 200 83 244 C84 274 88 300 94 320 C97 300 99 276 99 250 C99 204 95 154 99 124 Z"/>
  <path fill="url(#cl-hair)" d="M210 120 C216 156 219 200 217 244 C216 274 212 300 206 320 C203 300 201 276 201 250 C201 204 205 154 201 124 Z"/>
  <!-- sheen -->
  <path fill="#6fd6c5" opacity="0.34" d="M150 58 C118 58 96 78 86 112 C98 84 122 68 150 68 C178 68 202 84 214 112 C204 78 182 58 150 58 Z"/>
  <path d="M108 100 C122 82 142 74 160 74" fill="none" stroke="#a8efe2" stroke-width="5" stroke-linecap="round" opacity="0.35"/>
</svg>`;
		const YUNO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -20 340 560" width="340" height="560" role="img" aria-label="Sengoku Yuno mascot">
  <title>千石由乃 · Sengoku Yuno — DSH mascot (original fan art)</title>
  <defs>
    <linearGradient id="yu-hair" x1="0.25" y1="0" x2="0.75" y2="1">
      <stop offset="0" stop-color="#2a2436"/>
      <stop offset="0.45" stop-color="#1a1622"/>
      <stop offset="1" stop-color="#12101a"/>
    </linearGradient>
    <linearGradient id="yu-hair-back" x1="0.5" y1="0" x2="0.5" y2="1">
      <stop offset="0" stop-color="#241f31"/>
      <stop offset="0.5" stop-color="#17131f"/>
      <stop offset="1" stop-color="#0f0d16"/>
    </linearGradient>
    <linearGradient id="yu-pink" x1="0.3" y1="0" x2="0.7" y2="1">
      <stop offset="0" stop-color="#ff9ecd"/>
      <stop offset="1" stop-color="#e8558f"/>
    </linearGradient>
    <linearGradient id="yu-eye" x1="0.5" y1="0" x2="0.5" y2="1">
      <stop offset="0" stop-color="#ff7a92"/>
      <stop offset="0.42" stop-color="#e33a58"/>
      <stop offset="1" stop-color="#7d0f28"/>
    </linearGradient>
    <linearGradient id="yu-skin" x1="0.5" y1="0" x2="0.5" y2="1">
      <stop offset="0" stop-color="#fde8db"/>
      <stop offset="1" stop-color="#f0c5b0"/>
    </linearGradient>
    <linearGradient id="yu-skin-limb" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f8dccd"/>
      <stop offset="1" stop-color="#eec0aa"/>
    </linearGradient>
    <linearGradient id="yu-top" x1="0.5" y1="0" x2="0.5" y2="1">
      <stop offset="0" stop-color="#242130"/>
      <stop offset="1" stop-color="#121019"/>
    </linearGradient>
    <linearGradient id="yu-jacket" x1="0.3" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#f2556d"/>
      <stop offset="0.5" stop-color="#d92b47"/>
      <stop offset="1" stop-color="#9c1330"/>
    </linearGradient>
    <linearGradient id="yu-collar" x1="0.5" y1="0" x2="0.5" y2="1">
      <stop offset="0" stop-color="#6f6fc4"/>
      <stop offset="1" stop-color="#3f3f86"/>
    </linearGradient>
    <linearGradient id="yu-jacket-dark" x1="0.3" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#a81c37"/>
      <stop offset="1" stop-color="#630d1e"/>
    </linearGradient>
    <linearGradient id="yu-deck" x1="0.2" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#2b2b3a"/>
      <stop offset="1" stop-color="#0a0a12"/>
    </linearGradient>
    <radialGradient id="yu-glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ff6ea8" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#ff6ea8" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <ellipse cx="150" cy="524" rx="80" ry="13" fill="#000" opacity="0.15"/>

  <!-- ================= back hair ================= -->
  <path fill="url(#yu-hair-back)" d="M150 44
    C98 44 68 84 66 136
    C64 184 60 236 56 292
    C54 322 58 348 70 370
    C78 352 83 334 86 316
    C84 354 88 382 99 402
    C108 380 113 354 115 326
    C119 346 126 362 137 374
    C142 344 144 314 144 286 L156 286
    C156 314 158 344 163 374
    C174 362 181 346 185 326
    C187 354 192 380 201 402
    C212 382 216 354 214 316
    C217 334 222 352 230 370
    C242 348 246 322 244 292
    C240 236 236 184 234 136
    C232 84 202 44 150 44 Z"/>
  <!-- pink inner hair -->
  <path fill="url(#yu-pink)" opacity="0.5" d="M70 360 C80 342 85 320 87 296 C89 322 85 348 76 370 Z"/>
  <path fill="url(#yu-pink)" opacity="0.5" d="M230 360 C220 342 215 320 213 296 C211 322 215 348 224 370 Z"/>

  <!-- ================= floating launchpad ================= -->
  <g transform="translate(246 66) rotate(7) scale(0.92)">
    <ellipse cx="0" cy="30" rx="40" ry="22" fill="url(#yu-glow)"/>
    <rect x="-34" y="-24" width="68" height="58" rx="8" fill="url(#yu-deck)" stroke="#4a4a60" stroke-width="2"/>
    <rect x="-27" y="-17" width="54" height="34" rx="4" fill="#0a0a12"/>
    <g>
      <rect x="-23" y="-13" width="11" height="11" rx="2.5" fill="#ff5f9e"/>
      <rect x="-9" y="-13" width="11" height="11" rx="2.5" fill="#5fd8ff"/>
      <rect x="5" y="-13" width="11" height="11" rx="2.5" fill="#ffd45f"/>
      <rect x="-23" y="1" width="11" height="11" rx="2.5" fill="#8affa8"/>
      <rect x="-9" y="1" width="11" height="11" rx="2.5" fill="#c08aff"/>
      <rect x="5" y="1" width="11" height="11" rx="2.5" fill="#ff8a5f"/>
    </g>
    <rect x="19" y="-13" width="7" height="25" rx="3" fill="#2f2f42"/>
    <circle cx="0" cy="27" r="3" fill="#ff6ea8"/>
    <path d="M-10 -24 C-12 -33 -9 -39 -3 -42" fill="none" stroke="#4a4a60" stroke-width="2" stroke-linecap="round"/>
    <circle cx="-2" cy="-43" r="2.8" fill="#ff6ea8"/>
  </g>

  <!-- ================= legs ================= -->
  <path d="M127 372 L124 448" fill="none" stroke="url(#yu-skin-limb)" stroke-width="30" stroke-linecap="round"/>
  <path d="M173 372 L176 448" fill="none" stroke="url(#yu-skin-limb)" stroke-width="30" stroke-linecap="round"/>
  <!-- left: pink knee-high sock -->
  <path d="M126 400 L123 452" fill="none" stroke="#ef6ea8" stroke-width="32" stroke-linecap="round"/>
  <path d="M126 400 L123 452" fill="none" stroke="#ff8cc0" stroke-width="32" stroke-linecap="round" opacity="0.35"/>
  <!-- right: black ankle sock + rainbow band -->
  <path d="M174 424 L176 452" fill="none" stroke="#1c1a24" stroke-width="32" stroke-linecap="round"/>
  <path d="M174 420 L175 430" fill="none" stroke="#ffd45f" stroke-width="32" stroke-linecap="butt"/>
  <path d="M174 424 L175 430" fill="none" stroke="#5fd8ff" stroke-width="18" stroke-linecap="butt"/>
  <path d="M174 428 L175 432" fill="none" stroke="#ff5f9e" stroke-width="10" stroke-linecap="butt"/>

  <!-- ================= sneakers ================= -->
  <g>
    <path fill="#1b1a24" d="M108 448 L146 448 L148 474 C148 484 140 490 128 490 L106 490 C97 490 93 484 95 474 Z"/>
    <path fill="#e6e8ef" d="M92 474 L150 474 C150 485 143 492 130 492 L105 492 C95 492 91 485 92 474 Z"/>
    <path fill="#ef6ea8" d="M110 452 L144 452 L145 458 L109 458 Z"/>
    <path d="M112 462 L120 470 M122 462 L130 470 M132 462 L140 470" fill="none" stroke="#ef6ea8" stroke-width="3" stroke-linecap="round"/>
    <path fill="#1b1a24" d="M154 448 L192 448 C200 454 204 461 205 468 C205 481 197 490 185 490 L156 490 C152 490 152 479 152 474 Z"/>
    <path fill="#e6e8ef" d="M150 474 L208 474 C208 485 200 492 187 492 L156 492 C152 492 150 485 150 474 Z"/>
    <path fill="#ef6ea8" d="M156 452 L190 452 L192 458 L155 458 Z"/>
    <path d="M158 462 L166 470 M168 462 L176 470 M178 462 L186 470" fill="none" stroke="#ef6ea8" stroke-width="3" stroke-linecap="round"/>
  </g>

  <!-- ================= pleated skirt ================= -->
  <path fill="#1a1922" d="M106 336 L194 336 L208 400 C208 404 204 408 198 408 L102 408 C96 408 92 404 92 400 Z"/>
  <path fill="#2a2836" d="M106 336 L194 336 L196 346 L104 346 Z"/>
  <g stroke="#2f2d3d" stroke-width="2.4">
    <path d="M124 346 L116 406"/>
    <path d="M138 346 L132 406"/>
    <path d="M150 346 L150 406"/>
    <path d="M162 346 L168 406"/>
    <path d="M176 346 L184 406"/>
  </g>
  <path fill="#101018" d="M104 330 L196 330 L196 344 L104 344 Z"/>
  <rect x="138" y="326" width="24" height="22" rx="4" fill="#c9cdd8" stroke="#7d8290" stroke-width="2"/>
  <rect x="145" y="333" width="10" height="8" rx="2" fill="#1a1922"/>

  <!-- ================= midriff + crop top ================= -->
  <path fill="url(#yu-skin)" d="M110 294 L190 294 L192 338 L108 338 Z"/>
  <path fill="#e8b9a5" opacity="0.55" d="M110 294 L190 294 L190 304 L110 304 Z"/>
  <path d="M150 306 L150 332" stroke="#e8b9a5" stroke-width="2.6" stroke-linecap="round" opacity="0.75"/>
  <circle cx="150" cy="322" r="3" fill="#e0a892" opacity="0.8"/>
  <path fill="url(#yu-top)" d="M150 206
    C124 206 106 216 102 236
    C98 258 100 282 104 300
    L196 300
    C200 282 202 258 198 236
    C194 216 176 206 150 206 Z"/>
  <path fill="#100e17" d="M102 272 L198 272 L200 300 L100 300 Z"/>
  <!-- pink M emblem -->
  <g transform="translate(150 244)">
    <path d="M-15 12 L-15 -8 L-7 4 L0 -8 L7 4 L15 -8 L15 12" fill="none" stroke="#ff6ea8" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="-15" cy="16" r="2.4" fill="#ff6ea8"/>
    <circle cx="15" cy="16" r="2.4" fill="#ff6ea8"/>
  </g>
  <text x="150" y="292" font-family="Arial Black, Arial, sans-serif" font-size="10" font-weight="900" fill="#8f8fa8" text-anchor="middle" letter-spacing="1.4">MIDNIGHT</text>

  <!-- ================= jacket sleeves ================= -->
  <path d="M106 222 C84 244 72 292 74 344" fill="none" stroke="url(#yu-jacket)" stroke-width="44" stroke-linecap="round"/>
  <path d="M194 222 C216 244 228 292 226 344" fill="none" stroke="url(#yu-jacket)" stroke-width="44" stroke-linecap="round"/>
  <path d="M64 268 C70 258 84 256 92 262" fill="none" stroke="#9c1330" stroke-width="3" stroke-linecap="round"/>
  <path d="M236 268 C230 258 216 256 208 262" fill="none" stroke="#9c1330" stroke-width="3" stroke-linecap="round"/>
  <text x="72" y="300" font-family="Arial Black, Arial, sans-serif" font-size="11" font-weight="900" fill="#1a1922" text-anchor="middle" transform="rotate(-78 72 300)">YUNO</text>
  <text x="228" y="300" font-family="Arial Black, Arial, sans-serif" font-size="11" font-weight="900" fill="#1a1922" text-anchor="middle" transform="rotate(78 228 300)">YUNO</text>
  <circle cx="76" cy="366" r="15" fill="url(#yu-skin)"/>
  <circle cx="224" cy="366" r="15" fill="url(#yu-skin)"/>
  <path d="M62 350 C68 344 84 344 88 350 L90 366 C80 374 68 372 62 364 Z" fill="#8f1229"/>
  <path d="M238 350 C232 344 216 344 212 350 L210 366 C220 374 232 372 238 364 Z" fill="#8f1229"/>

  <!-- ================= jacket body (shadowed back panels) ================= -->
  <path fill="url(#yu-jacket-dark)" d="M100 208
    C72 220 56 246 52 280
    C48 314 54 346 64 374
    C82 382 98 374 102 358
    C90 322 88 262 100 208 Z"/>
  <path fill="url(#yu-jacket-dark)" d="M200 208
    C228 220 244 246 248 280
    C252 314 246 346 236 374
    C218 382 202 374 198 358
    C210 322 212 262 200 208 Z"/>
  <path d="M99 210 C74 222 58 248 54 280 C51 312 56 344 66 372" fill="none" stroke="#f2556d" stroke-width="2.4" stroke-linecap="round" opacity="0.75"/>
  <path d="M201 210 C226 222 242 248 246 280 C249 312 244 344 234 372" fill="none" stroke="#f2556d" stroke-width="2.4" stroke-linecap="round" opacity="0.75"/>
  <path fill="#b31d38" d="M100 208 C86 214 74 226 66 242 C78 230 90 220 104 213 Z"/>
  <path fill="#b31d38" d="M200 208 C214 214 226 226 234 242 C222 230 210 220 196 213 Z"/>
  <!-- puffer seams -->
  <path d="M70 250 C64 282 62 320 68 352" fill="none" stroke="#a51c36" stroke-width="2.6" stroke-linecap="round" opacity="0.8"/>
  <path d="M230 250 C236 282 238 320 232 352" fill="none" stroke="#a51c36" stroke-width="2.6" stroke-linecap="round" opacity="0.8"/>
  <path d="M56 288 C76 282 96 282 106 288" fill="none" stroke="#a51c36" stroke-width="2.6" stroke-linecap="round" opacity="0.75"/>
  <path d="M244 288 C224 282 204 282 194 288" fill="none" stroke="#a51c36" stroke-width="2.6" stroke-linecap="round" opacity="0.75"/>
  <!-- denim-blue collar -->
  <path fill="url(#yu-collar)" d="M100 208 C86 214 74 226 66 242 C80 228 96 218 110 212 Z"/>
  <path fill="url(#yu-collar)" d="M200 208 C214 214 226 226 234 242 C220 228 204 218 190 212 Z"/>
  <path fill="#2f2f66" opacity="0.7" d="M100 208 C92 212 84 218 78 226 C86 220 94 215 102 212 Z"/>
  <path fill="#2f2f66" opacity="0.7" d="M200 208 C208 212 216 218 222 226 C214 220 206 215 198 212 Z"/>
  <!-- zipper stops at the jacket hem -->
  <path d="M110 300 L110 318" stroke="#ffd45f" stroke-width="2.4" stroke-linecap="round" opacity="0.9"/>
  <path d="M190 300 L190 318" stroke="#ffd45f" stroke-width="2.4" stroke-linecap="round" opacity="0.9"/>

  <!-- ================= neck + choker ================= -->
  <path fill="#e8b9a5" d="M134 176 L166 176 L166 214 L134 214 Z"/>
  <path fill="#14121c" d="M130 188 L170 188 L170 202 L130 202 Z"/>
  <path fill="#ff6ea8" d="M150 187 L158 195 L150 203 L142 195 Z"/>
  <circle cx="150" cy="195" r="2.8" fill="#ffd0e6"/>

  <!-- ================= head ================= -->
  <path fill="url(#yu-skin)" d="M150 60 C114 60 94 90 94 130 C94 172 118 202 150 202 C182 202 206 172 206 130 C206 90 186 60 150 60 Z"/>
  <ellipse cx="110" cy="168" rx="14" ry="7.5" fill="#f79a94" opacity="0.42"/>
  <ellipse cx="190" cy="168" rx="14" ry="7.5" fill="#f79a94" opacity="0.42"/>

  <!-- eyes -->
  <g>
    <ellipse cx="123" cy="146" rx="15.5" ry="17.5" fill="#fdf7f4"/>
    <ellipse cx="177" cy="146" rx="15.5" ry="17.5" fill="#fdf7f4"/>
    <ellipse cx="123" cy="147" rx="12" ry="15" fill="url(#yu-eye)"/>
    <ellipse cx="177" cy="147" rx="12" ry="15" fill="url(#yu-eye)"/>
    <ellipse cx="123" cy="149" rx="5" ry="7.6" fill="#2b0611"/>
    <ellipse cx="177" cy="149" rx="5" ry="7.6" fill="#2b0611"/>
    <circle cx="127.5" cy="139" r="4.3" fill="#fff"/>
    <circle cx="181.5" cy="139" r="4.3" fill="#fff"/>
    <circle cx="119" cy="154" r="2.2" fill="#fff" opacity="0.85"/>
    <circle cx="173" cy="154" r="2.2" fill="#fff" opacity="0.85"/>
    <path d="M107 136 C114 124 134 122 140 135" fill="none" stroke="#181420" stroke-width="5.6" stroke-linecap="round"/>
    <path d="M193 136 C186 124 166 122 160 135" fill="none" stroke="#181420" stroke-width="5.6" stroke-linecap="round"/>
    <path d="M108 161 C115 169 131 170 138 163" fill="none" stroke="#181420" stroke-width="2.6" stroke-linecap="round" opacity="0.7"/>
    <path d="M192 161 C185 169 169 170 162 163" fill="none" stroke="#181420" stroke-width="2.6" stroke-linecap="round" opacity="0.7"/>
    <path d="M109 118 C118 112 132 112 139 117" fill="none" stroke="#2b2436" stroke-width="4" stroke-linecap="round"/>
    <path d="M191 118 C182 112 168 112 161 117" fill="none" stroke="#2b2436" stroke-width="4" stroke-linecap="round"/>
  </g>

  <path d="M142 180 C146 187 154 187 158 180" fill="none" stroke="#a4404a" stroke-width="3" stroke-linecap="round"/>

  <!-- ================= front hair ================= -->
  <path fill="url(#yu-hair)" d="M76 164
    C70 108 100 58 150 58
    C200 58 230 108 224 164
    C216 138 208 122 198 112
    C186 128 170 136 150 136
    C130 136 114 128 102 112
    C92 122 84 138 76 164 Z"/>
  <!-- pink streak in the fringe -->
  <path fill="url(#yu-pink)" d="M150 60 C138 60 128 63 120 68 C130 66 140 64 152 64 C164 66 174 70 182 76 C174 66 162 60 150 60 Z" opacity="0.95"/>
  <path fill="url(#yu-pink)" d="M124 108 C118 130 114 154 114 178 C109 152 110 126 118 106 Z"/>
  <path fill="url(#yu-hair)" d="M196 108 C204 130 208 154 208 178 C213 154 213 128 204 106 Z"/>
  <path fill="url(#yu-hair)" d="M96 108 C89 130 86 154 86 178 C81 154 82 128 90 106 Z"/>
  <!-- side locks with pink tips -->
  <path fill="url(#yu-hair)" d="M90 120 C84 156 81 200 83 244 C84 274 88 300 94 320 C97 300 99 276 99 250 C99 204 95 154 99 124 Z"/>
  <path fill="url(#yu-hair)" d="M210 120 C216 156 219 200 217 244 C216 274 212 300 206 320 C203 300 201 276 201 250 C201 204 205 154 201 124 Z"/>
  <path fill="url(#yu-pink)" opacity="0.85" d="M88 268 C90 290 93 306 96 320 C99 302 100 286 99 268 Z"/>
  <path fill="url(#yu-pink)" opacity="0.85" d="M212 268 C210 290 207 306 204 320 C201 302 200 286 201 268 Z"/>
  <!-- sheen -->
  <path fill="#4a3f5c" opacity="0.55" d="M150 58 C118 58 96 78 86 112 C98 84 122 68 150 68 C178 68 202 84 214 112 C204 78 182 58 150 58 Z"/>
  <path d="M108 100 C122 82 142 74 160 74" fill="none" stroke="#a99ec4" stroke-width="5" stroke-linecap="round" opacity="0.3"/>
  <!-- hair clip -->
  <g transform="translate(186 96) rotate(18)">
    <path d="M-9 0 L-3 0 L-3 -6 L3 -6 L3 0 L9 0 L9 6 L3 6 L3 12 L-3 12 L-3 6 L-9 6 Z" fill="#ff5f9e"/>
  </g>

  <!-- ================= cat-ear headphones ================= -->
  <!-- headband over the hair, ear to ear -->
  <path d="M92 126 C86 76 114 50 150 50 C186 50 214 76 208 126" fill="none" stroke="#1c1a24" stroke-width="12" stroke-linecap="round"/>
  <path d="M92 126 C86 76 114 50 150 50 C186 50 214 76 208 126" fill="none" stroke="#3a3648" stroke-width="3.4" stroke-linecap="round"/>
  <!-- cat ears -->
  <path d="M120 100 C106 74 101 44 106 18 C119 32 132 56 138 80 Z" fill="#1c1a24" stroke="#3a3648" stroke-width="2.6"/>
  <path d="M126 90 C117 70 114 48 118 30 C127 43 133 62 137 80 Z" fill="url(#yu-pink)"/>
  <path d="M180 100 C194 74 199 44 194 18 C181 32 168 56 162 80 Z" fill="#1c1a24" stroke="#3a3648" stroke-width="2.6"/>
  <path d="M174 90 C183 70 186 48 182 30 C173 43 167 62 163 80 Z" fill="url(#yu-pink)"/>
  <!-- earcups over the side locks -->
  <rect x="68" y="120" width="34" height="56" rx="16" fill="#22202c" stroke="#4a4658" stroke-width="2.6"/>
  <rect x="77" y="132" width="16" height="32" rx="8" fill="#3a3648"/>
  <circle cx="88" cy="176" r="4.4" fill="#ff5f9e"/>
  <rect x="198" y="120" width="34" height="56" rx="16" fill="#22202c" stroke="#4a4658" stroke-width="2.6"/>
  <rect x="207" y="132" width="16" height="32" rx="8" fill="#3a3648"/>
  <circle cx="212" cy="176" r="4.4" fill="#ff5f9e"/>
  <!-- mic boom -->
  <path d="M86 174 C88 196 104 206 122 202" fill="none" stroke="#3a3648" stroke-width="4" stroke-linecap="round"/>
  <circle cx="124" cy="202" r="5" fill="#ff5f9e"/>
</svg>`;
		//#endregion

		//#region mascot catalogue
		/**
		 * One selectable mascot. `accent` drives the panel chrome so the two
		 * characters read as a set without either one owning the layout.
		 */
		const MASCOTS = [
			{
				id: "closure",
				name: "可露希尔",
				latin: "Closure",
				role: "罗德岛 · 采购 / 工程",
				accent: "#37e0d8",
				accentSoft: "rgba(55, 224, 216, 0.16)",
				svg: CLOSURE_SVG,
			},
			{
				id: "yuno",
				name: "千石由乃",
				latin: "Sengoku Yuno",
				role: "梦限大MewType · DJ / Manipulator",
				accent: "#ff6ea8",
				accentSoft: "rgba(255, 110, 168, 0.16)",
				svg: YUNO_SVG,
			},
		];
		const STORAGE_KEY = "dsh.mascot.character";
		const BALANCE_ENDPOINT = "/dsh-mascot/api/balance";
		const BALANCE_REFRESH_MS = 120000;
		//#endregion

		//#region stylesheet
		const CSS = `
.dsh-mascot-root { position: absolute; right: 20px; bottom: 20px; z-index: 30; pointer-events: none;
  font-family: var(--dsh-font-sans, ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif); }
.dsh-mascot-dock { pointer-events: auto; display: flex; flex-direction: column; align-items: center; gap: 6px; }
/* Art sizing lives on the wrapper this plugin renders, never on the SVG's own
   attributes, so the same inlined source scales to every seat it appears in. */
.dsh-mascot-art { display: block; line-height: 0; }
.dsh-mascot-art > svg { display: block; width: 100%; height: 100%; }
.dsh-mascot-btn { appearance: none; border: 0; background: none; padding: 0; margin: 0; cursor: pointer;
  width: 106px; height: 176px; display: grid; place-items: center; border-radius: 16px;
  transition: transform .18s cubic-bezier(.2,.8,.3,1.2), filter .18s ease; filter: drop-shadow(0 10px 18px rgba(0,0,0,.42));
  animation: dsh-mascot-float 4.6s ease-in-out infinite; }
.dsh-mascot-btn:hover { transform: translateY(-4px) scale(1.035); filter: drop-shadow(0 14px 22px rgba(0,0,0,.5)); }
.dsh-mascot-btn:active { transform: translateY(-1px) scale(.985); }
.dsh-mascot-btn:focus-visible { outline: 2px solid var(--dsh-mascot-accent, #37e0d8); outline-offset: 3px; }
.dsh-mascot-btn .dsh-mascot-art { width: 104px; height: 172px; }
@keyframes dsh-mascot-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-5px) } }
@media (prefers-reduced-motion: reduce) { .dsh-mascot-btn { animation: none } }

.dsh-mascot-chip { pointer-events: auto; display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 10px; border-radius: 999px; font-size: 11px; line-height: 1.5; font-variant-numeric: tabular-nums;
  background: rgba(14, 17, 24, .82); color: #e7ecf3; border: 1px solid var(--dsh-mascot-accent, #37e0d8);
  box-shadow: 0 4px 12px rgba(0,0,0,.35); backdrop-filter: blur(8px); white-space: nowrap; }
.dsh-mascot-chip b { color: var(--dsh-mascot-accent, #37e0d8); font-weight: 700; }
.dsh-mascot-chip span { opacity: .65; }

.dsh-mascot-backdrop { position: absolute; inset: 0; pointer-events: auto; background: rgba(6, 8, 12, .28); }
/* The panel is anchored above the dock (204px tall plus the viewport's 20px
   inset and a 12px gap), so its own ceiling keeps it from ever growing past the
   top of the window and clipping its own header. */
.dsh-mascot-panel { position: absolute; right: 0; bottom: calc(100% + 12px); width: 344px; max-width: calc(100vw - 40px);
  max-height: calc(100vh - 244px); overflow-x: hidden; overflow-y: auto;
  pointer-events: auto; color: #e9eef5; border-radius: 18px;
  background: linear-gradient(160deg, rgba(30,34,44,.97), rgba(14,16,22,.98));
  border: 1px solid rgba(255,255,255,.09);
  box-shadow: 0 24px 60px rgba(0,0,0,.55), 0 0 0 1px var(--dsh-mascot-accent-soft, rgba(55,224,216,.16)) inset;
  animation: dsh-mascot-in .2s cubic-bezier(.2,.8,.3,1.1); }
@keyframes dsh-mascot-in { from { opacity: 0; transform: translateY(10px) scale(.97) } to { opacity: 1; transform: none } }
.dsh-mascot-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px 9px;
  border-bottom: 1px solid rgba(255,255,255,.07); background: var(--dsh-mascot-accent-soft, rgba(55,224,216,.16)); }
.dsh-mascot-avatar { width: 38px; height: 50px; flex: none; border-radius: 9px; overflow: hidden;
  background: rgba(0,0,0,.28); display: grid; place-items: center; }
.dsh-mascot-avatar .dsh-mascot-art { width: 34px; height: 56px; }
.dsh-mascot-title { flex: 1; min-width: 0; }
.dsh-mascot-title strong { display: block; font-size: 14px; letter-spacing: .3px; }
.dsh-mascot-title small { display: block; font-size: 11px; opacity: .6; margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-mascot-x { appearance: none; border: 0; cursor: pointer; width: 26px; height: 26px; border-radius: 8px;
  background: rgba(255,255,255,.07); color: #cfd6e0; font-size: 15px; line-height: 1; flex: none; }
.dsh-mascot-x:hover { background: rgba(255,255,255,.14); color: #fff; }
.dsh-mascot-body { padding: 11px 14px 13px; display: grid; gap: 10px; }

.dsh-mascot-hero { display: grid; gap: 6px; }
.dsh-mascot-hero-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.dsh-mascot-hero-top span { font-size: 11px; letter-spacing: .6px; text-transform: uppercase; opacity: .55; }
.dsh-mascot-hero-top b { font-size: 24px; font-variant-numeric: tabular-nums; letter-spacing: -.5px;
  color: var(--dsh-mascot-accent, #37e0d8); }
.dsh-mascot-bar { height: 6px; border-radius: 99px; background: rgba(255,255,255,.08); overflow: hidden; }
.dsh-mascot-bar > i { display: block; height: 100%; border-radius: 99px; transition: width .4s ease;
  background: linear-gradient(90deg, var(--dsh-mascot-accent, #37e0d8), rgba(255,255,255,.75)); }
.dsh-mascot-hint { font-size: 11px; opacity: .5; line-height: 1.45; }

.dsh-mascot-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.dsh-mascot-cell { background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.06);
  border-radius: 9px; padding: 5px 9px; min-width: 0; }
.dsh-mascot-cell em { display: block; font-style: normal; font-size: 10px; letter-spacing: .4px;
  text-transform: uppercase; opacity: .5; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-mascot-cell b { font-size: 14px; font-variant-numeric: tabular-nums; font-weight: 600; display: block;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-mascot-cell.wide { grid-column: 1 / -1; }

.dsh-mascot-balance { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-radius: 11px;
  background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.06); }
.dsh-mascot-balance .amt { flex: 1; min-width: 0; }
.dsh-mascot-balance .amt b { display: block; font-size: 18px; font-variant-numeric: tabular-nums; }
.dsh-mascot-balance .amt em { display: block; font-style: normal; font-size: 11px; opacity: .55; margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-mascot-refresh { appearance: none; border: 1px solid rgba(255,255,255,.12); cursor: pointer; flex: none;
  background: rgba(255,255,255,.06); color: #dbe2ec; border-radius: 9px; padding: 6px 10px; font-size: 11px; }
.dsh-mascot-refresh:hover { background: rgba(255,255,255,.13); }
.dsh-mascot-refresh:disabled { opacity: .45; cursor: default; }

.dsh-mascot-switch { display: flex; gap: 8px; }
.dsh-mascot-switch button { appearance: none; cursor: pointer; flex: 1; display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: 10px; background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.07); color: #dfe5ee; font-size: 12px; text-align: left; }
.dsh-mascot-switch button:hover { background: rgba(255,255,255,.09); }
.dsh-mascot-switch button[data-on="1"] { border-color: var(--dsh-mascot-accent, #37e0d8);
  background: var(--dsh-mascot-accent-soft, rgba(55,224,216,.16)); }
.dsh-mascot-switch .mini { width: 20px; height: 33px; flex: none; }
.dsh-mascot-switch .mini .dsh-mascot-art { width: 20px; height: 33px; }
.dsh-mascot-switch small { display: block; font-size: 10px; opacity: .55; }
`;

		/** Insert the mascot stylesheet once per plugin lifetime. */
		function installStyles() {
			const tag = document.createElement("style");
			tag.dataset.dshPlugin = "mascot";
			tag.textContent = CSS;
			document.head.append(tag);
			return () => {
				tag.remove();
			};
		}
		//#endregion

		//#region formatting helpers
		/** Thousands-separated integer, or an em dash while the figure is absent. */
		function count(value) {
			if (typeof value !== "number" || !Number.isFinite(value)) return "—";
			return Math.round(value).toLocaleString("en-US");
		}
		/** Compact figure for tight cells: 12.3k / 4.5M. */
		function compact(value) {
			if (typeof value !== "number" || !Number.isFinite(value)) return "—";
			if (Math.abs(value) < 1000) return String(Math.round(value));
			if (Math.abs(value) < 1e6) return `${(value / 1e3).toFixed(value < 1e4 ? 2 : 1)}k`;
			return `${(value / 1e6).toFixed(2)}M`;
		}
		/**
		 * One-decimal percentage, or an em dash when the denominator is unknown.
		 * A value that rounds to exactly 100 prints without the decimal, but an
		 * overshoot (an occupancy estimate above the context window) keeps its
		 * real figure instead of being flattened to 100.
		 */
		function percent(part, whole) {
			if (typeof part !== "number" || typeof whole !== "number" || whole <= 0) return "—";
			const rounded = Math.round((part / whole) * 1000) / 10;
			return `${rounded === 100 ? "100" : rounded.toFixed(1)}%`;
		}
		/** Clamp to [0, 1] for bar widths. */
		function ratio(part, whole) {
			if (typeof part !== "number" || typeof whole !== "number" || whole <= 0) return 0;
			return Math.max(0, Math.min(1, part / whole));
		}
		/** Short, human-sized session id for the footer line. */
		function shortId(id) {
			if (typeof id !== "string" || id.length === 0) return "—";
			return id.length <= 14 ? id : `${id.slice(0, 6)}…${id.slice(-5)}`;
		}
		/** Stored mascot choice, tolerating a locked-down or absent localStorage. */
		function readStoredCharacter() {
			try {
				const value = window.localStorage.getItem(STORAGE_KEY);
				return MASCOTS.some((m) => m.id === value) ? value : MASCOTS[0].id;
			} catch {
				return MASCOTS[0].id;
			}
		}
		/** Persist the mascot choice; a failure is never worth surfacing. */
		function writeStoredCharacter(id) {
			try {
				window.localStorage.setItem(STORAGE_KEY, id);
			} catch {
				/* storage unavailable — the choice simply does not persist */
			}
		}
		//#endregion

		//#region token statistics
		/**
		 * Derive the display statistics from the session projections.
		 *
		 * Shapes are owned by token-meter's wire views:
		 * `tokenUsage` → `{ uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }`,
		 * `contextPressure` → `{ contextWindow?, pressureTokens?, projectedTokens? }`.
		 *
		 * @param usage - the `tokenUsage` projection value, absent without a session.
		 * @param pressure - the `contextPressure` projection value, absent without a session.
		 * @returns every figure the panel renders, each `undefined` when unmeasurable.
		 */
		function deriveStats(usage, pressure) {
			const uncachedInput = usage?.uncachedInputTokens;
			const output = usage?.outputTokens;
			const cacheRead = usage?.cacheReadTokens;
			const cacheWrite = usage?.cacheWriteTokens;
			const billedInput = [uncachedInput, cacheRead, cacheWrite].every((n) => typeof n === "number")
				? uncachedInput + cacheRead + cacheWrite
				: undefined;
			const total = typeof billedInput === "number" && typeof output === "number" ? billedInput + output : undefined;
			const occupancy = typeof pressure?.projectedTokens === "number" ? pressure.projectedTokens : pressure?.pressureTokens;
			return {
				uncachedInput,
				output,
				cacheRead,
				cacheWrite,
				billedInput,
				total,
				cacheHit: billedInput === undefined ? undefined : ratio(cacheRead ?? 0, billedInput),
				cacheHitText: billedInput === undefined ? "—" : percent(cacheRead ?? 0, billedInput),
				occupancy,
				contextWindow: pressure?.contextWindow,
				occupancyRatio: pressure?.contextWindow === undefined ? 0 : ratio(occupancy, pressure.contextWindow),
				occupancyText: pressure?.contextWindow === undefined ? "—" : percent(occupancy, pressure.contextWindow),
			};
		}
		//#endregion

		//#region balance transport
		/**
		 * Read the account balance through the plugin's own host route. The API key
		 * never crosses to the browser: the host half resolves it from the
		 * credentials service and returns figures only.
		 *
		 * @param signal - abort signal owned by the caller's effect.
		 * @returns the host payload, or a synthesized failure object.
		 */
		async function fetchBalance(signal) {
			try {
				const response = await fetch(BALANCE_ENDPOINT, { signal, credentials: "same-origin", headers: { accept: "application/json" } });
				const payload = await response.json().catch(() => undefined);
				if (!response.ok) {
					return { ok: false, error: payload?.error ?? `http_${response.status}`, message: payload?.message ?? `主机返回 HTTP ${response.status}` };
				}
				return payload ?? { ok: false, error: "empty", message: "主机返回了空响应" };
			} catch (error) {
				if (error?.name === "AbortError") return undefined;
				return { ok: false, error: "unreachable", message: "无法访问主机余额接口" };
			}
		}
		//#endregion

		//#region components
		/** Inline SVG art; the source ships in `assets/` and is inlined by the sync script. */
		function Art({ svg }) {
			return h("span", { className: "dsh-mascot-art", dangerouslySetInnerHTML: { __html: svg } });
		}

		/**
		 * The stats panel. Registered as a `session-maybe` child of the overlay
		 * entry, so the renderer hands it `useProjection` / `useSession` / `sessionId`
		 * alongside the owner props this component's parent passes down.
		 */
		function MascotPanel(props) {
			const { mascot, mascots, onSelect, onClose, balance, balanceBusy, onRefresh, useProjection, sessionId } = props;
			const usage = useProjection("tokenUsage");
			const pressure = useProjection("contextPressure");
			const stats = deriveStats(usage, pressure);

			return h(
				"div",
				{ className: "dsh-mascot-panel", role: "dialog", "aria-label": `${mascot.name} · 用量面板` },
				h(
					"div",
					{ className: "dsh-mascot-head" },
					h("div", { className: "dsh-mascot-avatar" }, h(Art, { svg: mascot.svg })),
					h(
						"div",
						{ className: "dsh-mascot-title" },
						h("strong", null, mascot.name),
						h("small", null, `${mascot.latin} · ${mascot.role}`),
					),
					h("button", { type: "button", className: "dsh-mascot-x", onClick: onClose, "aria-label": "关闭" }, "×"),
				),
				h(
					"div",
					{ className: "dsh-mascot-body" },
					// ---- cache hit hero
					h(
						"div",
						{ className: "dsh-mascot-hero" },
						h(
							"div",
							{ className: "dsh-mascot-hero-top" },
							h("span", null, "Token 缓存命中"),
							h("b", null, stats.cacheHitText),
						),
						h("div", { className: "dsh-mascot-bar" }, h("i", { style: { width: `${Math.round(stats.cacheHit * 100)}%` } })),
						h(
							"div",
							{ className: "dsh-mascot-hint" },
							typeof stats.billedInput === "number"
								? `命中 ${count(stats.cacheRead)} / 计费输入 ${count(stats.billedInput)} · 命中率越高，单价越低`
								: "本会话还没有产生用量记录",
						),
					),
					// ---- token grid
					h(
						"div",
						{ className: "dsh-mascot-grid" },
						h("div", { className: "dsh-mascot-cell" }, h("em", null, "输入 (未命中)"), h("b", null, count(stats.uncachedInput))),
						h("div", { className: "dsh-mascot-cell" }, h("em", null, "缓存读取"), h("b", null, count(stats.cacheRead))),
						h("div", { className: "dsh-mascot-cell" }, h("em", null, "缓存写入"), h("b", null, count(stats.cacheWrite))),
						h("div", { className: "dsh-mascot-cell" }, h("em", null, "输出"), h("b", null, count(stats.output))),
						h(
							"div",
							{ className: "dsh-mascot-cell wide" },
							h("em", null, "本会话累计 Token"),
							h("b", null, `${count(stats.total)}${typeof stats.total === "number" ? `  (${compact(stats.total)})` : ""}`),
						),
					),
					// ---- context occupancy
					h(
						"div",
						{ className: "dsh-mascot-hero" },
						h(
							"div",
							{ className: "dsh-mascot-hero-top" },
							h("span", null, "上下文占用"),
							h("b", null, stats.occupancyText),
						),
						h("div", { className: "dsh-mascot-bar" }, h("i", { style: { width: `${Math.round(stats.occupancyRatio * 100)}%` } })),
						h(
							"div",
							{ className: "dsh-mascot-hint" },
							`${count(stats.occupancy)} / ${count(stats.contextWindow)} tokens`,
						),
					),
					// ---- balance
					h(
						"div",
						{ className: "dsh-mascot-balance" },
						h(
							"div",
							{ className: "amt" },
							h("b", null, balanceText(balance)),
							h("em", null, balanceDetail(balance)),
						),
						h("button", { type: "button", className: "dsh-mascot-refresh", onClick: onRefresh, disabled: balanceBusy === true }, balanceBusy === true ? "查询中…" : "刷新"),
					),
					// ---- mascot switcher
					h(
						"div",
						{ className: "dsh-mascot-switch" },
						mascots.map((item) =>
							h(
								"button",
								{ key: item.id, type: "button", "data-on": item.id === mascot.id ? "1" : "0", onClick: () => onSelect(item.id) },
								h("span", { className: "mini" }, h(Art, { svg: item.svg })),
								h("span", null, item.name, h("small", null, item.latin)),
							),
						),
					),
					h("div", { className: "dsh-mascot-hint" }, `会话 ${shortId(sessionId)}`),
				),
			);
		}

		/** Balance headline: the amount when known, otherwise the failure in one word. */
		function balanceText(balance) {
			if (balance === undefined) return "查询中…";
			if (balance.ok !== true) return "不可用";
			const amount = balance.totalBalance;
			if (amount === undefined || amount === null) return "—";
			return `${currencySymbol(balance.currency)}${amount}`;
		}

		/** Balance sub-line: currency source, availability, or the concrete failure. */
		function balanceDetail(balance) {
			if (balance === undefined) return "正在向 DeepSeek 查询账户余额";
			if (balance.ok !== true) return balance.message ?? balance.error ?? "查询失败";
			const parts = [];
			if (balance.currency !== undefined) parts.push(balance.currency);
			if (balance.isAvailable === false) parts.push("余额不足");
			if (balance.toppedUpBalance !== undefined) parts.push(`充值 ${currencySymbol(balance.currency)}${balance.toppedUpBalance}`);
			if (balance.grantedBalance !== undefined) parts.push(`赠送 ${currencySymbol(balance.currency)}${balance.grantedBalance}`);
			return parts.join(" · ") || "已连接";
		}

		/** Currency glyph for the two units the balance endpoint reports. */
		function currencySymbol(currency) {
			if (currency === "CNY") return "¥";
			if (currency === "USD") return "$";
			return "";
		}

		/**
		 * Root overlay entry: the floating mascot plus the panel seat.
		 *
		 * Registered into `shell.overlay` (a root-scoped list slot), so this file
		 * owns the frame-wide surface; the panel itself is rendered through a
		 * `session-maybe` child slot this entry declares, which is what gives it
		 * the session projections.
		 */
		function MascotOverlay(props) {
			const [open, setOpen] = React.useState(false);
			const [character, setCharacter] = React.useState(readStoredCharacter);
			const [balance, setBalance] = React.useState(undefined);
			const [balanceBusy, setBalanceBusy] = React.useState(false);
			const [refreshToken, setRefreshToken] = React.useState(0);
			const mascot = MASCOTS.find((m) => m.id === character) ?? MASCOTS[0];

			// Balance refresh: re-runs on open and on every manual refresh, and the
			// interval only exists while the panel is open.
			React.useEffect(() => {
				if (!open) return undefined;
				const controller = new AbortController();
				let cancelled = false;
				const load = async () => {
					setBalanceBusy(true);
					const payload = await fetchBalance(controller.signal);
					if (cancelled || payload === undefined) return;
					setBalance(payload);
					setBalanceBusy(false);
				};
				load();
				const timer = window.setInterval(load, BALANCE_REFRESH_MS);
				return () => {
					cancelled = true;
					window.clearInterval(timer);
					controller.abort();
				};
			}, [open, refreshToken]);

			// Escape closes the panel; the listener exists only while it is open.
			React.useEffect(() => {
				if (!open) return undefined;
				const onKey = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [open]);

			const select = (id) => {
				setCharacter(id);
				writeStoredCharacter(id);
			};

			// The custom properties must sit on both siblings: the backdrop is not a
			// descendant of the dock, and CSS variables only inherit down the tree.
			const theme = { "--dsh-mascot-accent": mascot.accent, "--dsh-mascot-accent-soft": mascot.accentSoft };

			return h(
				React.Fragment,
				null,
				open ? h("div", { className: "dsh-mascot-backdrop", style: theme, onClick: () => setOpen(false) }) : null,
				h(
					"div",
					{ className: "dsh-mascot-root", style: theme },
					open
						? props.renderSlot("mascot.panel", {
								mascot,
								mascots: MASCOTS,
								onSelect: select,
								onClose: () => setOpen(false),
								balance,
								balanceBusy,
								onRefresh: () => setRefreshToken((n) => n + 1),
							})
						: null,
					h(
						"div",
						{ className: "dsh-mascot-dock" },
						h(
							"button",
							{
								type: "button",
								className: "dsh-mascot-btn",
								onClick: () => setOpen((value) => !value),
								"aria-expanded": open,
								"aria-label": `${mascot.name} — 查看 Token 用量与余额`,
								title: `${mascot.name} · 点击查看 Token 命中 / 余额`,
							},
							h(Art, { svg: mascot.svg }),
						),
						h(
							"span",
							{ className: "dsh-mascot-chip" },
							balance?.ok === true && balance.totalBalance !== undefined
								? h(React.Fragment, null, h("span", null, "余额"), h("b", null, `${currencySymbol(balance.currency)}${balance.totalBalance}`))
								: h(React.Fragment, null, h("span", null, "点我"), h("b", null, "Token / 余额")),
						),
					),
				),
			);
		}
		//#endregion

		//#region plugin
		/** Required service: the UI slot registry. */
		const inject = ["slots"];

		/**
		 * Mount the mascot: one frame-wide overlay entry that declares its own
		 * session-scoped panel seat.
		 * @param ctx - Client root context.
		 */
		function apply(ctx) {
			ctx.slots.inject("shell.overlay", function* () {
				const removeStyles = installStyles();
				yield () => removeStyles();
				yield ctx.slots.register(
					{
						name: "shell.overlay",
						id: "mascot",
						order: 50,
						children: { "mascot.panel": { kind: "single", scope: "session-maybe" } },
					},
					MascotOverlay,
				);
			});
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		// The runner only reads `apply`/`inject`; the rest is exported so the
		// self-test and the preview harness can drive the real components instead
		// of a copy of them.
		exports.MASCOTS = MASCOTS;
		exports.deriveStats = deriveStats;
		exports.MascotOverlay = MascotOverlay;
		exports.MascotPanel = MascotPanel;
		return module.exports;
	},
});
