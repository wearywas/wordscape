import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createWorldGroup, disposeWorldGroup } from '../world/threeAdapter';
import {
  createWalkContext,
  findWalkSpawn,
  moveWalker,
  WALK_EYE_HEIGHT,
  WALK_SPEED,
} from '../world/walk';
import type { WalkContext, WalkPosition } from '../world/walk';
import type { ObjectKind, WorldDocument } from '../world/types';
import './WorldScene.css';

export interface WorldSceneProps {
  world: WorldDocument;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  visibleKinds: ObjectKind[];
  resetKey?: number;
  terrainEnabled?: boolean;
  /** Full workbench only; preview cards remain orbit-only. */
  allowWalk?: boolean;
  interactionBlocked?: boolean;
}

interface SceneRuntime {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  controls: OrbitControls;
  renderer: THREE.WebGLRenderer;
  worldGroup: THREE.Group;
  selection: THREE.Group;
  frame: (world: WorldDocument) => void;
  enterWalk: () => void;
  exitWalk: () => void;
  clearInput: () => void;
}

function updateSelection(runtime: SceneRuntime, selectedId: string | null): void {
  disposeWorldGroup(runtime.selection);
  runtime.selection.clear();
  if (!selectedId) return;
  const selected = runtime.worldGroup.children.find(
    (object) => object.userData.worldObjectId === selectedId,
  );
  if (!selected) return;
  selected.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(selected);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const outline = new THREE.Box3Helper(bounds.expandByScalar(0.5), '#bd6345');
  const outlineMaterial = outline.material as THREE.LineBasicMaterial;
  outlineMaterial.depthTest = false;
  outlineMaterial.transparent = true;
  outlineMaterial.opacity = 0.86;
  outline.renderOrder = 10;
  runtime.selection.add(outline);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.95, 1, 64),
    new THREE.MeshBasicMaterial({
      color: '#c56b4b',
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthTest: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.scale.set(Math.max(size.x * 0.64, 2.5), Math.max(size.z * 0.64, 2.5), 1);
  ring.position.set(center.x, bounds.min.y + 0.25, center.z);
  ring.renderOrder = 9;
  runtime.selection.add(ring);
}

export function WorldScene({
  world,
  selectedId,
  onSelect,
  visibleKinds,
  resetKey = 0,
  terrainEnabled = true,
  allowWalk = false,
  interactionBlocked = false,
}: WorldSceneProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SceneRuntime | null>(null);
  const latestRef = useRef({
    world,
    selectedId,
    onSelect,
    visibleKinds,
    terrainEnabled,
    allowWalk,
    interactionBlocked,
  });
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [walking, setWalking] = useState(false);
  const [walkMessage, setWalkMessage] = useState('');
  latestRef.current = {
    world,
    selectedId,
    onSelect,
    visibleKinds,
    terrainEnabled,
    allowWalk,
    interactionBlocked,
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setError(null);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      setError(
        'This browser could not start the 3D view. The world remains available in the map and object list.',
      );
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor('#edece5', 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    const canvas = renderer.domElement;
    canvas.style.cssText =
      'display:block;width:100%;height:100%;touch-action:none;outline-offset:-4px;';
    canvas.setAttribute(
      'aria-label',
      'Interactive three-dimensional world. Drag to orbit, right-drag to pan, and scroll to zoom. Use the object list to select objects with a keyboard.',
    );
    canvas.setAttribute('role', 'img');
    canvas.tabIndex = 0;
    container.appendChild(canvas);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-250, 250, 250, -250, 0.1, 5000);
    const walkCamera = new THREE.PerspectiveCamera(65, 1, 0.06, 5000);
    walkCamera.rotation.order = 'YXZ';
    let walker: {
      context: WalkContext;
      position: WalkPosition;
      yaw: number;
      pitch: number;
    } | null = null;
    const keys = new Set<string>();
    let lookPointer: { id: number; x: number; y: number } | null = null;
    const blocked = () => {
      const modal = document.querySelector('dialog[open]');
      // Preview scenes inside the active dialog remain interactive.
      return latestRef.current.interactionBlocked || Boolean(modal && !modal.contains(canvas));
    };
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minPolarAngle = 0.14;
    controls.maxPolarAngle = Math.PI / 2.18;
    controls.minZoom = 0.45;
    controls.maxZoom = 6;
    controls.zoomSpeed = 0.8;
    controls.panSpeed = 0.8;
    controls.listenToKeyEvents(canvas);
    const ambient = new THREE.HemisphereLight('#fff5dc', '#a3b3b6', 2.2);
    scene.add(ambient);
    const sunlight = new THREE.DirectionalLight('#fff2d6', 2.8);
    sunlight.position.set(-160, 350, 190);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(2048, 2048);
    sunlight.shadow.normalBias = 0.7;
    sunlight.shadow.bias = -0.0002;
    const span = Math.max(
      latestRef.current.world.bounds.width,
      latestRef.current.world.bounds.depth,
    );
    sunlight.shadow.camera.left = -span;
    sunlight.shadow.camera.right = span;
    sunlight.shadow.camera.top = span;
    sunlight.shadow.camera.bottom = -span;
    sunlight.shadow.camera.far = 1200;
    sunlight.shadow.camera.updateProjectionMatrix();
    scene.add(sunlight);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(span * 12, span * 12),
      new THREE.ShadowMaterial({ color: '#69746e', opacity: 0.13 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -span * 0.017 - 1;
    floor.receiveShadow = true;
    scene.add(floor);
    const selection = new THREE.Group();
    scene.add(selection);
    const runtime: SceneRuntime = {
      scene,
      camera,
      controls,
      renderer,
      worldGroup: new THREE.Group(),
      selection,
      clearInput: () => {
        keys.clear();
        if (lookPointer && canvas.hasPointerCapture(lookPointer.id))
          canvas.releasePointerCapture(lookPointer.id);
        lookPointer = null;
      },
      exitWalk: () => {
        runtime.clearInput();
        walker = null;
        controls.enabled = !blocked();
        scene.background = null;
        canvas.dataset.viewMode = 'orbit';
        canvas.setAttribute(
          'aria-label',
          'Interactive three-dimensional world. Drag to orbit, right-drag to pan, and scroll to zoom.',
        );
        setWalking(false);
      },
      enterWalk: () => {
        if (!latestRef.current.allowWalk || blocked()) return;
        const current = latestRef.current;
        const context = createWalkContext(current.world, current.terrainEnabled);
        const selected = current.world.objects.find((object) => object.id === current.selectedId);
        const position = findWalkSpawn(context, selected ? [selected.x, selected.y] : undefined);
        if (!position) {
          setWalkMessage(
            'No clear, resolved ground was found. Walking needs terrain coverage or an explicit flat view, away from water and solid footprints.',
          );
          return;
        }
        runtime.clearInput();
        // Drain pending orbit inertia without changing the pose that will be restored.
        const orbitPosition = camera.position.clone();
        const orbitTarget = controls.target.clone();
        const orbitZoom = camera.zoom;
        const damping = controls.enableDamping;
        controls.enableDamping = false;
        controls.update();
        camera.position.copy(orbitPosition);
        controls.target.copy(orbitTarget);
        camera.zoom = orbitZoom;
        camera.updateProjectionMatrix();
        controls.update();
        controls.enableDamping = damping;
        walker = { context, position, yaw: 0, pitch: 0 };
        // Orbit camera state remains intact so leaving walking restores the exact previous view.
        controls.enabled = false;
        walkCamera.far = Math.max(
          5000,
          Math.max(current.world.bounds.width, current.world.bounds.depth) * 4,
        );
        walkCamera.updateProjectionMatrix();
        scene.background = new THREE.Color('#e9eee7');
        canvas.dataset.viewMode = 'walk';
        canvas.setAttribute(
          'aria-label',
          'Human-scale 3D view. W A S D or arrow keys move. Drag to look. Escape returns to orbit.',
        );
        setWalkMessage('');
        setWalking(true);
        canvas.focus({ preventScroll: true });
      },
      frame: (document) => {
        if (walker) runtime.exitWalk();
        // Consume pending orbit/pan inertia before setting a deterministic home pose.
        const damping = controls.enableDamping;
        controls.enableDamping = false;
        controls.update();
        const extent = Math.max(document.bounds.width, document.bounds.depth);
        camera.far = Math.max(5000, extent * 8);
        sunlight.position.set(-extent * 0.45, extent, extent * 0.53);
        sunlight.shadow.camera.left = sunlight.shadow.camera.bottom = -extent;
        sunlight.shadow.camera.right = sunlight.shadow.camera.top = extent;
        sunlight.shadow.camera.far = Math.max(1200, extent * 6);
        sunlight.shadow.camera.updateProjectionMatrix();
        const aspect = Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1);
        const fallbackTallest = Math.max(
          1,
          ...document.objects.map((object) => object.elevation + object.height),
        );
        const contentBounds = new THREE.Box3().setFromObject(runtime.worldGroup);
        if (contentBounds.isEmpty())
          contentBounds.set(
            new THREE.Vector3(
              -document.bounds.width / 2,
              -extent * 0.02,
              -document.bounds.depth / 2,
            ),
            new THREE.Vector3(
              document.bounds.width / 2,
              fallbackTallest,
              document.bounds.depth / 2,
            ),
          );
        const targetY = contentBounds.min.y + (contentBounds.max.y - contentBounds.min.y) * 0.35;
        camera.position.set(extent * 0.95, extent * 1.05 + targetY, extent * 1.2);
        controls.target.set(0, targetY, 0);
        floor.position.y = contentBounds.min.y - 0.2;
        camera.lookAt(controls.target);
        camera.updateMatrixWorld(true);
        const viewBounds = new THREE.Box3();
        for (const x of [contentBounds.min.x, contentBounds.max.x]) {
          for (const y of [contentBounds.min.y, contentBounds.max.y]) {
            for (const z of [contentBounds.min.z, contentBounds.max.z]) {
              viewBounds.expandByPoint(
                new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse),
              );
            }
          }
        }
        const requiredWidth = Math.max(Math.abs(viewBounds.min.x), Math.abs(viewBounds.max.x)) * 2;
        const requiredHeight = Math.max(Math.abs(viewBounds.min.y), Math.abs(viewBounds.max.y)) * 2;
        const verticalSpan = Math.max(requiredHeight, requiredWidth / aspect) * 1.09;
        camera.left = (-verticalSpan * aspect) / 2;
        camera.right = (verticalSpan * aspect) / 2;
        camera.top = verticalSpan / 2;
        camera.bottom = -verticalSpan / 2;
        camera.zoom = 1;
        camera.updateProjectionMatrix();
        controls.update();
        controls.enableDamping = damping;
        controls.saveState();
      },
    };
    runtimeRef.current = runtime;
    const resize = (): void => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      const aspect = width / height;
      // Preserve vertical view size and camera position while the editor panels resize.
      const viewHeight = camera.top - camera.bottom;
      camera.left = (-viewHeight * aspect) / 2;
      camera.right = (viewHeight * aspect) / 2;
      camera.updateProjectionMatrix();
      walkCamera.aspect = aspect;
      walkCamera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    runtime.frame(latestRef.current.world);
    resize();
    let pointerStart: { x: number; y: number; id: number; moved: boolean } | null = null;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      if (blocked()) return;
      if (walker) {
        canvas.focus({ preventScroll: true });
        lookPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
        canvas.setPointerCapture(event.pointerId);
        return;
      }
      if (pointerStart) {
        pointerStart.moved = true;
        return;
      }
      pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId, moved: false };
    };
    const handlePointerMove = (event: PointerEvent): void => {
      if (walker && lookPointer?.id === event.pointerId && !blocked()) {
        walker.yaw -= (event.clientX - lookPointer.x) * 0.004;
        walker.pitch = Math.max(
          -Math.PI * 0.43,
          Math.min(Math.PI * 0.43, walker.pitch - (event.clientY - lookPointer.y) * 0.004),
        );
        lookPointer.x = event.clientX;
        lookPointer.y = event.clientY;
        return;
      }
      if (
        pointerStart &&
        Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4
      )
        pointerStart.moved = true;
    };
    const handlePointerUp = (event: PointerEvent): void => {
      if (walker) {
        if (lookPointer && canvas.hasPointerCapture(lookPointer.id))
          canvas.releasePointerCapture(lookPointer.id);
        lookPointer = null;
        return;
      }
      const start = pointerStart;
      pointerStart = null;
      if (!start || start.id !== event.pointerId || start.moved || event.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster
        .intersectObject(runtime.worldGroup, true)
        .find((intersection) => typeof intersection.object.userData.worldObjectId === 'string');
      latestRef.current.onSelect(hit ? String(hit.object.userData.worldObjectId) : null);
    };
    const cancelPointer = (): void => {
      pointerStart = null;
      runtime.clearInput();
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (blocked()) {
        runtime.clearInput();
        return;
      }
      if (walker) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          runtime.exitWalk();
        } else if (
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(
            event.key.toLowerCase(),
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
          keys.add(event.key.toLowerCase());
        }
        return;
      }
      if (event.key === 'Escape') latestRef.current.onSelect(null);
      if (event.key === 'Home' || event.key.toLowerCase() === 'r')
        runtime.frame(latestRef.current.world);
      if (event.key === '+' || event.key === '=') camera.zoom = Math.min(6, camera.zoom * 1.15);
      if (event.key === '-') camera.zoom = Math.max(0.45, camera.zoom / 1.15);
      camera.updateProjectionMatrix();
    };
    const handleKeyUp = (event: KeyboardEvent): void => {
      keys.delete(event.key.toLowerCase());
    };
    const handleWindowKey = (event: KeyboardEvent): void => {
      if (walker && event.key === 'Escape' && !blocked()) {
        event.preventDefault();
        runtime.exitWalk();
      }
    };
    const clearInput = (): void => {
      runtime.clearInput();
      pointerStart = null;
    };
    let animationFrame = 0;
    let isAlive = true;
    const handleContextLost = (event: Event): void => {
      event.preventDefault();
      isAlive = false;
      cancelAnimationFrame(animationFrame);
      setError('The 3D view lost its graphics connection. Your world data is unchanged.');
    };
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', cancelPointer);
    canvas.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('keydown', handleWindowKey);
    canvas.addEventListener('blur', clearInput);
    window.addEventListener('blur', clearInput);
    document.addEventListener('visibilitychange', clearInput);
    canvas.addEventListener('webglcontextlost', handleContextLost);
    let lastTime = performance.now();
    const animate = (time = performance.now()): void => {
      if (!isAlive) return;
      animationFrame = requestAnimationFrame(animate);
      const dt = Math.min(0.05, Math.max(0, (time - lastTime) / 1000));
      lastTime = time;
      if (walker) {
        if (blocked() || document.hidden || document.activeElement !== canvas) runtime.clearInput();
        const forward =
          Number(keys.has('w') || keys.has('arrowup')) -
          Number(keys.has('s') || keys.has('arrowdown'));
        const right =
          Number(keys.has('d') || keys.has('arrowright')) -
          Number(keys.has('a') || keys.has('arrowleft'));
        const length = Math.hypot(forward, right);
        if (length > 0) {
          const speed = (WALK_SPEED * dt) / length;
          walker.position = moveWalker(
            walker.context,
            walker.position,
            (right * Math.cos(walker.yaw) - forward * Math.sin(walker.yaw)) * speed,
            (forward * Math.cos(walker.yaw) + right * Math.sin(walker.yaw)) * speed,
          );
        }
        const { position } = walker;
        walkCamera.position.set(
          position.x - latestRef.current.world.bounds.width / 2,
          position.ground + WALK_EYE_HEIGHT,
          -(position.y - latestRef.current.world.bounds.depth / 2),
        );
        walkCamera.rotation.set(walker.pitch, walker.yaw, 0, 'YXZ');
        canvas.dataset.walkPosition = `${position.x.toFixed(3)},${position.y.toFixed(3)},${position.ground.toFixed(3)}`;
        renderer.render(scene, walkCamera);
      } else {
        controls.enabled = !blocked();
        if (controls.enabled) controls.update();
        renderer.render(scene, camera);
      }
    };
    animate();
    return () => {
      isAlive = false;
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointercancel', cancelPointer);
      canvas.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('keydown', handleWindowKey);
      canvas.removeEventListener('blur', clearInput);
      window.removeEventListener('blur', clearInput);
      document.removeEventListener('visibilitychange', clearInput);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      controls.dispose();
      sunlight.shadow.dispose();
      disposeWorldGroup(scene);
      renderer.dispose();
      canvas.remove();
      runtimeRef.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    setWalkMessage('');
    runtime.exitWalk();
    runtime.scene.remove(runtime.worldGroup);
    disposeWorldGroup(runtime.worldGroup);
    runtime.worldGroup = createWorldGroup(world, visibleKinds, { terrainEnabled });
    runtime.scene.add(runtime.worldGroup);
    updateSelection(runtime, selectedId);
    // Selection has its own effect; changing it must not rebuild the world.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, visibleKinds, terrainEnabled, attempt]);

  useEffect(() => {
    if (runtimeRef.current) updateSelection(runtimeRef.current, selectedId);
  }, [selectedId, attempt]);

  useEffect(() => {
    if (interactionBlocked) runtimeRef.current?.clearInput();
    if (!allowWalk) runtimeRef.current?.exitWalk();
  }, [interactionBlocked, allowWalk]);

  useEffect(() => {
    runtimeRef.current?.frame(latestRef.current.world);
  }, [resetKey, world.bounds.width, world.bounds.depth, world.terrain, terrainEnabled, attempt]);

  return (
    <div
      ref={containerRef}
      className={`world-scene ${walking ? 'is-walking' : ''}`}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    >
      {allowWalk && !error && (
        <div className="world-walk-controls">
          <button
            type="button"
            disabled={interactionBlocked}
            onClick={() =>
              walking ? runtimeRef.current?.exitWalk() : runtimeRef.current?.enterWalk()
            }
          >
            {walking ? 'Return to orbit' : 'Walk here'}
          </button>
          {walking && (
            <button
              type="button"
              disabled={interactionBlocked}
              onClick={() => runtimeRef.current?.enterWalk()}
            >
              Reset walk
            </button>
          )}
          {walking && (
            <p>
              WASD / arrows to move · drag to look · Esc to exit
              <br />
              <span>
                1.7 m eye · approximate collision, not a surveyed route
                {!world.terrain || !terrainEnabled ? ' · flat ground assumed' : ''}
              </span>
            </p>
          )}
          {walkMessage && <p role="status">{walkMessage}</p>}
        </div>
      )}
      {error && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeContent: 'center',
            gap: 16,
            padding: 32,
            textAlign: 'center',
            background: '#eeede6',
            color: '#394c43',
            zIndex: 1,
          }}
        >
          <p style={{ maxWidth: 380, margin: 0, lineHeight: 1.6 }}>{error}</p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            style={{
              justifySelf: 'center',
              padding: '10px 18px',
              border: '1px solid #748278',
              borderRadius: 6,
              background: '#fcfaf4',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            Retry 3D view
          </button>
        </div>
      )}
    </div>
  );
}
