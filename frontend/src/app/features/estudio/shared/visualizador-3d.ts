import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild, signal } from '@angular/core';

/**
 * Visualizador de modelo 3D (GLB/GLTF) e de gaussian splat (PLY/SPZ/SPLAT) com órbita de câmera.
 * Three.js e o Spark (splats) só carregam quando o visualizador aparece — o resto do Estúdio não
 * paga o peso.
 */
@Component({
  selector: 'e-visualizador-3d',
  standalone: true,
  template: `
    <div class="v3d" #caixa>
      @if (estado() !== 'pronto') { <div class="v3d-msg">{{ estado() === 'erro' ? erro() : 'Carregando o 3D…' }}</div> }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .v3d { position: relative; width: 100%; height: 100%; min-height: 240px; background: radial-gradient(circle at 50% 40%, #3a3a44, #16161a); border-radius: inherit; overflow: hidden; }
    .v3d-msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #ddd; font-size: 13px; padding: 16px; text-align: center; }
  `],
})
export class Visualizador3dComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) url!: string;
  /** modelo3d (GLB) ou mundo (splat). */
  @Input() tipo: 'modelo3d' | 'mundo' = 'modelo3d';
  /** Nome do arquivo (a extensão decide o formato do splat). */
  @Input() nome = '';
  @ViewChild('caixa', { static: true }) caixa!: ElementRef<HTMLDivElement>;

  readonly estado = signal<'carregando' | 'pronto' | 'erro'>('carregando');
  readonly erro = signal('');
  private parar: (() => void) | null = null;
  private iniciado = false;

  ngAfterViewInit(): void {
    this.iniciado = true;
    void this.montar();
  }

  ngOnChanges(): void {
    if (this.iniciado) void this.montar();
  }

  ngOnDestroy(): void {
    this.parar?.();
  }

  private async montar(): Promise<void> {
    this.parar?.();
    this.estado.set('carregando');
    try {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      const el = this.caixa.nativeElement;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      el.appendChild(renderer.domElement);
      renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none';

      const cena = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 2000);
      camera.position.set(0, 1, 3);
      const controles = new OrbitControls(camera, renderer.domElement);
      controles.enableDamping = true;
      cena.add(new THREE.HemisphereLight(0xffffff, 0x444455, 2.2));
      const sol = new THREE.DirectionalLight(0xffffff, 2);
      sol.position.set(3, 5, 4);
      cena.add(sol);

      if (this.tipo === 'mundo') {
        const { SplatMesh } = await import('@sparkjsdev/spark');
        const splat = new SplatMesh({ url: this.url, fileName: this.nome || undefined });
        // Splats do Marble e da maioria dos geradores vêm de cabeça para baixo no sistema do Three.
        splat.quaternion.set(1, 0, 0, 0);
        cena.add(splat);
        await splat.initialized;
        camera.position.set(0, 0, 0.01);
        controles.target.set(0, 0, -1);
      } else {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const gltf = await new GLTFLoader().loadAsync(this.url);
        const obj = gltf.scene;
        const caixa = new THREE.Box3().setFromObject(obj);
        const tam = caixa.getSize(new THREE.Vector3()).length() || 1;
        const centro = caixa.getCenter(new THREE.Vector3());
        obj.position.sub(centro);
        cena.add(obj);
        camera.position.set(tam * 0.6, tam * 0.4, tam * 0.9);
        camera.near = tam / 100;
        camera.far = tam * 100;
        camera.updateProjectionMatrix();
      }

      const ajustar = () => {
        const w = el.clientWidth || 300;
        const h = el.clientHeight || 240;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      const obs = new ResizeObserver(ajustar);
      obs.observe(el);
      ajustar();
      let quadro = 0;
      const animar = () => {
        controles.update();
        renderer.render(cena, camera);
        quadro = requestAnimationFrame(animar);
      };
      animar();
      this.estado.set('pronto');
      this.parar = () => {
        cancelAnimationFrame(quadro);
        obs.disconnect();
        controles.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    } catch (e) {
      this.erro.set('Não consegui abrir este 3D no navegador: ' + (e instanceof Error ? e.message : String(e)));
      this.estado.set('erro');
    }
  }
}
