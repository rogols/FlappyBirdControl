/**
 * Three.js scene adapter for the Flappy Bird simulation.
 *
 * Renders game state using primitive geometry only (Phase 0 visual pass):
 *   - Bird: small yellow sphere
 *   - Obstacles: green box pairs (top pipe + bottom pipe)
 *   - Background: dark sky
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
	/** Bird visual radius */
	birdRadius: number;
}

const DEFAULT_SCENE_CONFIG: SceneConfig = {
	worldYMin: 0,
	worldYMax: 10,
	obstacleHalfWidth: 0.5,
	birdRadius: 0.3
};

export class GameScene {
	private renderer: THREE.WebGLRenderer | null = null;
	private scene: THREE.Scene | null = null;
	private camera: THREE.OrthographicCamera | null = null;
	private birdMesh: THREE.Mesh | null = null;
	/** Map from obstacle identity index to their top and bottom pipe meshes */
	private obstacleMeshes: Map<number, { top: THREE.Mesh; bottom: THREE.Mesh }> = new Map();
	private config: SceneConfig;

	// --- Overlay meshes (created lazily, shown only in auto mode) ---
	/** Horizontal dashed-line stand-in: thin flat box spanning the visible world width */
	private setpointLineMesh: THREE.Mesh | null = null;
	/** Small rectangle near the bird showing normalised control effort magnitude */
	private effortBarMesh: THREE.Mesh | null = null;

	constructor(config: Partial<SceneConfig> = {}) {
		this.config = { ...DEFAULT_SCENE_CONFIG, ...config };
	}

	/**
	 * Initialise the Three.js renderer and scene, attaching to the given canvas.
	 * Must be called before render().
	 */
	init(canvas: HTMLCanvasElement): void {
		const width = canvas.clientWidth || canvas.width;
		const height = canvas.clientHeight || canvas.height;

		// Renderer
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		this.renderer.setSize(width, height, false);
		this.renderer.setClearColor(0x1a1a2e);

		// Scene
		this.scene = new THREE.Scene();

		// Orthographic camera — maps world units directly to screen
		// World: x = -2 to 18 (visible scroll range), y = 0 to 10
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

		// Ambient light
		const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
		this.scene.add(ambientLight);

		// Directional light
		const directionalLight = new THREE.DirectionalLight(0xffffff, 0.4);
		directionalLight.position.set(5, 10, 5);
		this.scene.add(directionalLight);

		// Bird mesh: yellow sphere
		const birdGeometry = new THREE.SphereGeometry(this.config.birdRadius, 16, 16);
		const birdMaterial = new THREE.MeshLambertMaterial({ color: 0xffd700 });
		this.birdMesh = new THREE.Mesh(birdGeometry, birdMaterial);
		this.scene.add(this.birdMesh);
	}

	/**
	 * Render one frame given the current world state and obstacle list.
	 * Creates/removes obstacle meshes as needed.
	 *
	 * @param state     - Current world state from the engine
	 * @param obstacles - Active obstacle list from the engine
	 * @param overlay   - When provided, debug overlays for auto mode are rendered.
	 *                    Pass undefined or omit to hide all overlays (manual mode).
	 */
	render(state: WorldState, obstacles: Obstacle[], overlay?: OverlayData): void {
		if (!this.renderer || !this.scene || !this.camera || !this.birdMesh) {
			return;
		}

		// Update bird position
		// Bird is at x=0 in world frame; in scene we place it at a fixed screen x
		this.birdMesh.position.set(0, state.physics.y, 0);

		// Synchronise obstacle meshes
		this.syncObstacleMeshes(obstacles);

		// Render auto-mode debug overlays
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
		if (!this.renderer || !this.camera) {
			return;
		}
		this.renderer.setSize(width, height, false);

		const worldWidth = 20;
		const worldHeight = this.config.worldYMax - this.config.worldYMin;
		const aspect = width / height;
		const cameraHalfWidth = (worldWidth / 2) * aspect;
		const cameraHalfHeight = worldHeight / 2;

		this.camera.left = -cameraHalfWidth;
		this.camera.right = cameraHalfWidth;
		this.camera.top = cameraHalfHeight;
		this.camera.bottom = -cameraHalfHeight;
		this.camera.updateProjectionMatrix();
	}

	/**
	 * Free all Three.js resources. Call when the component is destroyed.
	 */
	dispose(): void {
		if (this.scene) {
			this.scene.clear();
		}
		this.obstacleMeshes.clear();
		this.birdMesh = null;
		this.setpointLineMesh = null;
		this.effortBarMesh = null;
		if (this.renderer) {
			this.renderer.dispose();
			this.renderer = null;
		}
		this.scene = null;
		this.camera = null;
	}

	/**
	 * Add, update, or remove obstacle pipe meshes to match the current obstacle list.
	 * Uses obstacle x position as a proxy identity key.
	 */
	private syncObstacleMeshes(obstacles: Obstacle[]): void {
		if (!this.scene) {
			return;
		}

		const worldHeight = this.config.worldYMax - this.config.worldYMin;
		const pipeWidth = this.config.obstacleHalfWidth * 2;

		// Build a set of current obstacle x keys (rounded to avoid float noise)
		const activeKeys = new Set(obstacles.map((_, i) => i));

		// Remove meshes that no longer have a corresponding obstacle
		for (const [key, meshPair] of this.obstacleMeshes) {
			if (!activeKeys.has(key)) {
				this.scene.remove(meshPair.top);
				this.scene.remove(meshPair.bottom);
				meshPair.top.geometry.dispose();
				meshPair.bottom.geometry.dispose();
				this.obstacleMeshes.delete(key);
			}
		}

		// Create or update meshes for current obstacles
		obstacles.forEach((obstacle, index) => {
			const topPipeHeight = worldHeight - obstacle.gapTop;
			const bottomPipeHeight = obstacle.gapBottom - this.config.worldYMin;

			if (!this.obstacleMeshes.has(index)) {
				// Create new pipe pair
				const material = new THREE.MeshLambertMaterial({ color: 0x4caf50 });

				const topGeom = new THREE.BoxGeometry(pipeWidth, Math.max(topPipeHeight, 0.01), 0.5);
				const topMesh = new THREE.Mesh(topGeom, material);
				this.scene!.add(topMesh);

				const bottomGeom = new THREE.BoxGeometry(pipeWidth, Math.max(bottomPipeHeight, 0.01), 0.5);
				const bottomMesh = new THREE.Mesh(bottomGeom, material);
				this.scene!.add(bottomMesh);

				this.obstacleMeshes.set(index, { top: topMesh, bottom: bottomMesh });
			}

			const meshPair = this.obstacleMeshes.get(index)!;

			// Position top pipe: centred above gapTop
			meshPair.top.position.set(obstacle.x, obstacle.gapTop + topPipeHeight / 2, 0);

			// Position bottom pipe: centred below gapBottom
			meshPair.bottom.position.set(obstacle.x, this.config.worldYMin + bottomPipeHeight / 2, 0);
		});
	}

	/**
	 * Create or update the setpoint line and effort bar overlay meshes.
	 *
	 * Setpoint line: a thin flat box spanning the visible world width, positioned at
	 * the setpoint height.  Green when error is small, red/blue when large.
	 *
	 * Effort bar: a small rectangle to the right of the bird whose height is
	 * proportional to controlEffort (0–1).  Colour is orange when thrusting.
	 */
	private updateOverlayMeshes(overlay: OverlayData, birdY: number): void {
		if (!this.scene) {
			return;
		}

		// --- Setpoint line ---
		// Use a thin box 20 world-units wide × 0.05 tall to represent the dashed line.
		if (!this.setpointLineMesh) {
			const geom = new THREE.BoxGeometry(20, 0.05, 0.1);
			const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.7 });
			this.setpointLineMesh = new THREE.Mesh(geom, mat);
			this.setpointLineMesh.renderOrder = 1;
			this.scene.add(this.setpointLineMesh);
		}

		// Colour the line: green near zero error, shift toward red/blue on large error
		const absError = Math.abs(overlay.error);
		const errorSaturation = Math.min(absError / 3, 1); // saturates at ±3 world units
		const lineMaterial = this.setpointLineMesh.material as THREE.MeshBasicMaterial;
		if (overlay.error > 0) {
			// Bird is below setpoint — line shifts red to indicate downward error
			lineMaterial.color.setRGB(errorSaturation, 1 - errorSaturation * 0.5, 0);
		} else {
			// Bird is above setpoint — line shifts blue
			lineMaterial.color.setRGB(0, 1 - errorSaturation * 0.5, errorSaturation);
		}

		// Reposition centred at setpoint height; x centred in camera view
		const cameraWorldCentreX = 10 - 2; // matches camera lookAt x
		this.setpointLineMesh.position.set(cameraWorldCentreX, overlay.setpoint, 0.5);
		this.setpointLineMesh.visible = true;

		// --- Control effort bar ---
		// A vertical rectangle 0.3 wide, height proportional to controlEffort (max 2 wu).
		const effortBarMaxHeight = 2.0; // world units
		const effortHeight = Math.max(overlay.controlEffort * effortBarMaxHeight, 0.05);

		if (!this.effortBarMesh) {
			const geom = new THREE.BoxGeometry(0.3, effortHeight, 0.1);
			const mat = new THREE.MeshBasicMaterial({ color: 0xff8800 });
			this.effortBarMesh = new THREE.Mesh(geom, mat);
			this.effortBarMesh.renderOrder = 1;
			this.scene.add(this.effortBarMesh);
		} else {
			// Rebuild geometry to reflect new height (cheap: box is small)
			this.effortBarMesh.geometry.dispose();
			this.effortBarMesh.geometry = new THREE.BoxGeometry(0.3, effortHeight, 0.1);
		}

		// Place bar to the right of the bird, bottom-anchored at bird's Y
		this.effortBarMesh.position.set(0.8, birdY + effortHeight / 2, 0.5);
		this.effortBarMesh.visible = true;
	}

	/**
	 * Hide the overlay meshes without destroying them (they will be reused next frame).
	 */
	private hideOverlayMeshes(): void {
		if (this.setpointLineMesh) {
			this.setpointLineMesh.visible = false;
		}
		if (this.effortBarMesh) {
			this.effortBarMesh.visible = false;
		}
	}
}
