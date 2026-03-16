/**
 * Three.js scene adapter for the Flappy Bird simulation.
 *
 * Phase 6 visual pass: replaces primitive geometry with sprites from
 * the samuelcust/flappy-bird-assets repository served from /sprites/.
 *
 *   - Background: background-day.png tiled behind the scene
 *   - Bird: animated yellowbird (downflap/midflap/upflap) based on velocity
 *   - Pipes: pipe-green.png scaled to the required height; top pipe is flipped
 *   - Base: base.png scrolling ground strip
 *
 * Graceful degradation: if a texture fails to load the fallback solid-colour
 * material from Phase 0 is used so the game always renders something.
 *
 * This class is the only place in the codebase that imports Three.js.
 * It reads WorldState and renders it — no game logic lives here.
 */

import * as THREE from 'three';
import type { WorldState } from './state.ts';
import type { Obstacle } from './obstacles.ts';

/**
 * Optional overlay data passed to render() when an automatic controller is active.
 * When this is provided, debug visualisations are drawn (setpoint line, effort bar).
 * When undefined/null, no overlays are drawn — manual mode stays clean.
 */
export interface OverlayData {
	/** Target height the controller is driving toward (world units) */
	setpoint: number;
	/** Signed control error = setpoint − measurement (positive: bird too low) */
	error: number;
	/** Control effort normalised to [0, 1] for effort bar height */
	controlEffort: number;
	/** Optional named internal controller variables (e.g. integral, derivative) */
	controllerInternals?: Record<string, number>;
}

/** Visual configuration for the scene */
export interface SceneConfig {
	/** World Y minimum — maps to visual floor */
	worldYMin: number;
	/** World Y maximum — maps to visual ceiling */
	worldYMax: number;
	/** Half-width of obstacle pipes in world units */
	obstacleHalfWidth: number;
	/** Bird visual radius (used for fallback sphere size) */
	birdRadius: number;
}

const DEFAULT_SCENE_CONFIG: SceneConfig = {
	worldYMin: 0,
	worldYMax: 10,
	obstacleHalfWidth: 0.5,
	birdRadius: 0.3
};

// ---------------------------------------------------------------------------
// Sprite dimensions in world units (derived from pixel dims at ~40 px/unit)
// ---------------------------------------------------------------------------
/** Bird sprite width in world units (34 px → 0.85 wu) */
const BIRD_W = 0.85;
/** Bird sprite height in world units (24 px → 0.60 wu) */
const BIRD_H = 0.6;
/** Pipe width in world units — matches obstacleHalfWidth * 2 exactly */
const PIPE_W = 1.0;
/** Base/ground strip height in world units (112 px → 2.8 wu, cap at 1.5) */
const BASE_H = 1.5;

// Base scroll speed (world units/second) — must match engine scrollSpeed
const BASE_SCROLL_SPEED = 3.0;

export class GameScene {
	private renderer: THREE.WebGLRenderer | null = null;
	private scene: THREE.Scene | null = null;
	private camera: THREE.OrthographicCamera | null = null;
	private config: SceneConfig;

	// --- Textured sprite meshes ---
	private backgroundMesh: THREE.Mesh | null = null;
	private baseMesh: THREE.Mesh | null = null;
	private birdMesh: THREE.Mesh | null = null;

	/** Three bird animation frames (down / mid / up) */
	private birdTextures: [THREE.Texture | null, THREE.Texture | null, THREE.Texture | null] = [
		null,
		null,
		null
	];

	/** Loaded pipe texture (shared between all pipe instances) */
	private pipeTexture: THREE.Texture | null = null;

	/** Map from obstacle index to their top and bottom pipe meshes */
	private obstacleMeshes: Map<number, { top: THREE.Mesh; bottom: THREE.Mesh }> = new Map();

	// --- Overlay meshes (shown only in auto mode) ---
	private setpointLineMesh: THREE.Mesh | null = null;
	private effortBarMesh: THREE.Mesh | null = null;

	/** Accumulated wall-clock time used for base scrolling animation */
	private wallTime = 0;

	constructor(config: Partial<SceneConfig> = {}) {
		this.config = { ...DEFAULT_SCENE_CONFIG, ...config };
	}

	/**
	 * Initialise the Three.js renderer, scene, and load sprite textures.
	 * Returns a Promise that resolves once all textures are loaded (or failed).
	 * The scene renders with solid-colour fallbacks until this resolves.
	 */
	async init(canvas: HTMLCanvasElement): Promise<void> {
		const width = canvas.clientWidth || canvas.width;
		const height = canvas.clientHeight || canvas.height;

		// Renderer
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
		this.renderer.setSize(width, height, false);
		this.renderer.setClearColor(0x70c5ce); // sky-blue fallback

		// Scene
		this.scene = new THREE.Scene();

		// Orthographic camera — world x: -2 to 18, y: 0 to 10
		const worldWidth = 20;
		const worldHeight = this.config.worldYMax - this.config.worldYMin;
		const aspect = width / height;
		const cameraHalfWidth = (worldWidth / 2) * aspect;
		const cameraHalfHeight = worldHeight / 2;

		this.camera = new THREE.OrthographicCamera(
			-cameraHalfWidth,
			cameraHalfWidth,
			cameraHalfHeight,
			-cameraHalfHeight,
			0.1,
			100
		);
		this.camera.position.set(worldWidth / 2 - 2, worldHeight / 2, 10);
		this.camera.lookAt(worldWidth / 2 - 2, worldHeight / 2, 0);

		// Load textures in parallel; fallback to null on error
		const [bgTex, baseTex, pipeTex, birdDownTex, birdMidTex, birdUpTex] = await Promise.all([
			this.loadTexture('/sprites/background-day.png'),
			this.loadTexture('/sprites/base.png'),
			this.loadTexture('/sprites/pipe-green.png'),
			this.loadTexture('/sprites/yellowbird-downflap.png'),
			this.loadTexture('/sprites/yellowbird-midflap.png'),
			this.loadTexture('/sprites/yellowbird-upflap.png')
		]);

		this.pipeTexture = pipeTex;
		this.birdTextures = [birdDownTex, birdMidTex, birdUpTex];

		// --- Background ---
		const bgWidth = cameraHalfWidth * 2;
		const bgHeight = worldHeight;
		if (bgTex) {
			// Tile horizontally to fill the wide camera view
			bgTex.wrapS = THREE.RepeatWrapping;
			bgTex.wrapT = THREE.ClampToEdgeWrapping;
			// background-day is 288×512 px; at worldHeight=10 → texWidth = 10*(288/512) ≈ 5.625 wu
			const texWorldWidth = worldHeight * (288 / 512);
			bgTex.repeat.set(bgWidth / texWorldWidth, 1);
			const bgMat = new THREE.MeshBasicMaterial({ map: bgTex });
			const bgGeom = new THREE.PlaneGeometry(bgWidth, bgHeight);
			this.backgroundMesh = new THREE.Mesh(bgGeom, bgMat);
			this.backgroundMesh.position.set(worldWidth / 2 - 2, worldHeight / 2, -2);
			this.scene.add(this.backgroundMesh);
		}

		// --- Base / ground ---
		const baseWidth = bgWidth + 2; // extra to avoid edge gaps
		if (baseTex) {
			// base.png is 336×112; tile horizontally to fill
			baseTex.wrapS = THREE.RepeatWrapping;
			baseTex.wrapT = THREE.ClampToEdgeWrapping;
			const baseTexWorldWidth = BASE_H * (336 / 112);
			baseTex.repeat.set(baseWidth / baseTexWorldWidth, 1);
			const baseMat = new THREE.MeshBasicMaterial({ map: baseTex });
			const baseGeom = new THREE.PlaneGeometry(baseWidth, BASE_H);
			this.baseMesh = new THREE.Mesh(baseGeom, baseMat);
			// Position so top of base aligns with y=0 (world floor)
			this.baseMesh.position.set(worldWidth / 2 - 2, -BASE_H / 2, -0.5);
			this.scene.add(this.baseMesh);
		}

		// --- Bird ---
		const birdTex = birdMidTex ?? birdDownTex ?? birdUpTex;
		const birdMat = birdTex
			? new THREE.MeshBasicMaterial({ map: birdTex, transparent: true })
			: new THREE.MeshLambertMaterial({ color: 0xffd700 });

		const birdGeom = new THREE.PlaneGeometry(BIRD_W, BIRD_H);
		this.birdMesh = new THREE.Mesh(birdGeom, birdMat);
		this.birdMesh.position.set(0, 5, 1);
		this.scene.add(this.birdMesh);

		// Add a basic ambient light for non-textured fallback materials
		this.scene.add(new THREE.AmbientLight(0xffffff, 1));
	}

	/**
	 * Render one frame given the current world state and obstacle list.
	 *
	 * @param state     - Current world state from the engine
	 * @param obstacles - Active obstacle list from the engine
	 * @param overlay   - Debug overlays for auto mode (omit to hide)
	 * @param wallDt    - Wall-clock delta time since last frame (for base animation)
	 */
	render(state: WorldState, obstacles: Obstacle[], overlay?: OverlayData, wallDt = 0): void {
		if (!this.renderer || !this.scene || !this.camera || !this.birdMesh) {
			return;
		}

		// Update base scroll offset
		this.wallTime += wallDt;

		// --- Bird position and animation frame ---
		this.birdMesh.position.set(0, state.physics.y, 1);

		// Pick animation frame based on vertical velocity
		const birdFrame = this.pickBirdFrame(state.physics.v);
		const frameTex = this.birdTextures[birdFrame];
		if (frameTex) {
			(this.birdMesh.material as THREE.MeshBasicMaterial).map = frameTex;
			(this.birdMesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
		}

		// Tilt bird: nose up when rising, nose down when falling (clamp to ±30°)
		const tiltRad = Math.max(-Math.PI / 6, Math.min(Math.PI / 6, state.physics.v * 0.08));
		this.birdMesh.rotation.z = tiltRad;

		// --- Scroll base ---
		if (this.baseMesh) {
			const mat = this.baseMesh.material as THREE.MeshBasicMaterial;
			if (mat.map) {
				const baseWidth = cameraHalfWidth(this.camera) * 2 + 2;
				const baseTexWorldWidth = BASE_H * (336 / 112);
				const offsetX = ((this.wallTime * BASE_SCROLL_SPEED) / baseTexWorldWidth) % 1;
				mat.map.offset.x = offsetX;
				mat.map.repeat.set(baseWidth / baseTexWorldWidth, 1);
			}
		}

		// --- Obstacle meshes ---
		this.syncObstacleMeshes(obstacles);

		// --- Overlays ---
		if (overlay !== undefined) {
			this.updateOverlayMeshes(overlay, state.physics.y);
		} else {
			this.hideOverlayMeshes();
		}

		this.renderer.render(this.scene, this.camera);
	}

	/**
	 * Resize the renderer when the canvas size changes.
	 */
	resize(width: number, height: number): void {
		if (!this.renderer || !this.camera) return;
		this.renderer.setSize(width, height, false);

		const worldWidth = 20;
		const worldHeight = this.config.worldYMax - this.config.worldYMin;
		const aspect = width / height;
		const hw = (worldWidth / 2) * aspect;
		const hh = worldHeight / 2;

		this.camera.left = -hw;
		this.camera.right = hw;
		this.camera.top = hh;
		this.camera.bottom = -hh;
		this.camera.updateProjectionMatrix();
	}

	/**
	 * Free all Three.js resources.
	 */
	dispose(): void {
		if (this.scene) this.scene.clear();
		this.obstacleMeshes.clear();
		this.birdMesh = null;
		this.backgroundMesh = null;
		this.baseMesh = null;
		this.setpointLineMesh = null;
		this.effortBarMesh = null;
		this.birdTextures = [null, null, null];
		this.pipeTexture = null;
		if (this.renderer) {
			this.renderer.dispose();
			this.renderer = null;
		}
		this.scene = null;
		this.camera = null;
	}

	// ---------------------------------------------------------------------------
	// Private helpers
	// ---------------------------------------------------------------------------

	/** Load a texture and resolve to null on error (graceful degradation). */
	private loadTexture(url: string): Promise<THREE.Texture | null> {
		return new Promise((resolve) => {
			const loader = new THREE.TextureLoader();
			loader.load(
				url,
				(tex) => {
					tex.magFilter = THREE.NearestFilter;
					tex.minFilter = THREE.NearestFilter;
					resolve(tex);
				},
				undefined,
				() => resolve(null)
			);
		});
	}

	/** Pick bird animation frame index (0=down, 1=mid, 2=up) based on velocity. */
	private pickBirdFrame(v: number): 0 | 1 | 2 {
		if (v > 1.5) return 2; // upflap — thrusting upward
		if (v < -1.5) return 0; // downflap — falling
		return 1; // midflap — coasting
	}

	/**
	 * Create or update textured pipe plane meshes to match the current obstacle list.
	 */
	private syncObstacleMeshes(obstacles: Obstacle[]): void {
		if (!this.scene) return;

		const worldHeight = this.config.worldYMax - this.config.worldYMin;
		const activeKeys = new Set(obstacles.map((_, i) => i));

		// Remove stale meshes
		for (const [key, meshPair] of this.obstacleMeshes) {
			if (!activeKeys.has(key)) {
				this.scene.remove(meshPair.top);
				this.scene.remove(meshPair.bottom);
				meshPair.top.geometry.dispose();
				meshPair.bottom.geometry.dispose();
				this.obstacleMeshes.delete(key);
			}
		}

		obstacles.forEach((obstacle, index) => {
			const topPipeHeight = Math.max(worldHeight - obstacle.gapTop, 0.01);
			const bottomPipeHeight = Math.max(obstacle.gapBottom - this.config.worldYMin, 0.01);

			if (!this.obstacleMeshes.has(index)) {
				const topMesh = this.makePipeMesh(PIPE_W, topPipeHeight, true);
				const bottomMesh = this.makePipeMesh(PIPE_W, bottomPipeHeight, false);
				this.scene!.add(topMesh);
				this.scene!.add(bottomMesh);
				this.obstacleMeshes.set(index, { top: topMesh, bottom: bottomMesh });
			}

			const meshPair = this.obstacleMeshes.get(index)!;

			// Rebuild geometry if height changed significantly (pipes can change on respawn)
			const existingTopH = (meshPair.top.geometry as THREE.PlaneGeometry).parameters?.height ?? 0;
			const existingBotH =
				(meshPair.bottom.geometry as THREE.PlaneGeometry).parameters?.height ?? 0;

			if (Math.abs(existingTopH - topPipeHeight) > 0.01) {
				meshPair.top.geometry.dispose();
				meshPair.top.geometry = new THREE.PlaneGeometry(PIPE_W, topPipeHeight);
				this.applyPipeTexture(
					meshPair.top.material as THREE.MeshBasicMaterial,
					topPipeHeight,
					true
				);
			}
			if (Math.abs(existingBotH - bottomPipeHeight) > 0.01) {
				meshPair.bottom.geometry.dispose();
				meshPair.bottom.geometry = new THREE.PlaneGeometry(PIPE_W, bottomPipeHeight);
				this.applyPipeTexture(
					meshPair.bottom.material as THREE.MeshBasicMaterial,
					bottomPipeHeight,
					false
				);
			}

			// Position: top pipe centred above gapTop, bottom pipe centred below gapBottom
			meshPair.top.position.set(obstacle.x, obstacle.gapTop + topPipeHeight / 2, 0);
			meshPair.bottom.position.set(obstacle.x, this.config.worldYMin + bottomPipeHeight / 2, 0);
		});
	}

	/** Create a pipe mesh for either the top (flipped) or bottom orientation. */
	private makePipeMesh(width: number, height: number, isTop: boolean): THREE.Mesh {
		const geom = new THREE.PlaneGeometry(width, height);
		const mat = new THREE.MeshBasicMaterial({
			color: 0x4caf50,
			transparent: !!this.pipeTexture
		});
		this.applyPipeTexture(mat, height, isTop);
		return new THREE.Mesh(geom, mat);
	}

	/**
	 * Apply the pipe texture to a MeshBasicMaterial, configuring repeat and flip.
	 *
	 * pipe-green.png is 52×320 px — the cap is at the TOP of the image.
	 * For a bottom pipe: image is used as-is (cap at top → faces the gap).
	 * For a top pipe: rotate 180° so the cap points downward into the gap.
	 * We implement the flip via texture offset/repeat rather than mesh rotation
	 * so that the PlaneGeometry UV coordinates work naturally.
	 */
	private applyPipeTexture(mat: THREE.MeshBasicMaterial, pipeHeight: number, isTop: boolean): void {
		if (!this.pipeTexture) return;

		// Clone the texture so each pipe can have independent offset/repeat
		const tex = this.pipeTexture.clone();
		tex.needsUpdate = true;
		tex.wrapS = THREE.ClampToEdgeWrapping;
		tex.wrapT = THREE.RepeatWrapping;
		tex.magFilter = THREE.NearestFilter;
		tex.minFilter = THREE.NearestFilter;

		// pipe-green.png: 52×320 px. In world units at ~40px/unit:
		// full pipe image height = 320/40 = 8.0 wu, width = 52/40 = 1.3 wu
		const pipeImgHeight = 8.0;

		// Show only as many texture rows as needed for this pipe's height
		const vRepeat = pipeHeight / pipeImgHeight;

		if (isTop) {
			// Flip vertically: texture goes from bottom to top instead of top to bottom
			tex.repeat.set(1, -vRepeat);
			tex.offset.set(0, vRepeat);
		} else {
			tex.repeat.set(1, vRepeat);
			tex.offset.set(0, 0);
		}

		mat.map = tex;
		mat.transparent = true;
		mat.needsUpdate = true;
	}

	/**
	 * Create or update the setpoint line and effort bar overlay meshes.
	 */
	private updateOverlayMeshes(overlay: OverlayData, birdY: number): void {
		if (!this.scene) return;

		// --- Setpoint line ---
		if (!this.setpointLineMesh) {
			const geom = new THREE.PlaneGeometry(20, 0.06);
			const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.7 });
			this.setpointLineMesh = new THREE.Mesh(geom, mat);
			this.setpointLineMesh.renderOrder = 2;
			this.scene.add(this.setpointLineMesh);
		}

		const absError = Math.abs(overlay.error);
		const errorSat = Math.min(absError / 3, 1);
		const lineMat = this.setpointLineMesh.material as THREE.MeshBasicMaterial;
		if (overlay.error > 0) {
			lineMat.color.setRGB(errorSat, 1 - errorSat * 0.5, 0);
		} else {
			lineMat.color.setRGB(0, 1 - errorSat * 0.5, errorSat);
		}
		this.setpointLineMesh.position.set(8, overlay.setpoint, 2);
		this.setpointLineMesh.visible = true;

		// --- Effort bar ---
		const effortBarMaxH = 2.0;
		const effortH = Math.max(overlay.controlEffort * effortBarMaxH, 0.05);

		if (!this.effortBarMesh) {
			const geom = new THREE.PlaneGeometry(0.3, effortH);
			const mat = new THREE.MeshBasicMaterial({ color: 0xff8800 });
			this.effortBarMesh = new THREE.Mesh(geom, mat);
			this.effortBarMesh.renderOrder = 2;
			this.scene.add(this.effortBarMesh);
		} else {
			this.effortBarMesh.geometry.dispose();
			this.effortBarMesh.geometry = new THREE.PlaneGeometry(0.3, effortH);
		}
		this.effortBarMesh.position.set(0.8, birdY + effortH / 2, 2);
		this.effortBarMesh.visible = true;
	}

	private hideOverlayMeshes(): void {
		if (this.setpointLineMesh) this.setpointLineMesh.visible = false;
		if (this.effortBarMesh) this.effortBarMesh.visible = false;
	}
}

// ---------------------------------------------------------------------------
// Module-level helper (avoids 'this' issues in render arrow functions)
// ---------------------------------------------------------------------------

/** Extract the half-width from an ortho camera's current left value. */
function cameraHalfWidth(cam: THREE.OrthographicCamera): number {
	return cam.right;
}
