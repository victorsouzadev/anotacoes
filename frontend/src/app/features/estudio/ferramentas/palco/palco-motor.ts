import type * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Junta, Pose, aplicarPose, montarBoneco } from './boneco';

export type TipoObjeto = 'boneco' | 'modelo' | 'forma' | 'imagem';
export type Forma = 'cubo' | 'esfera' | 'cilindro' | 'cone' | 'plano';

/** Um objeto da cena, como é salvo (quadro "cena") e como o MCP descreve. */
export interface ObjetoCena {
  id: string;
  tipo: TipoObjeto;
  nome: string;
  posicao: [number, number, number];
  /** Graus. */
  rotacao: [number, number, number];
  escala: [number, number, number];
  cor?: string;
  forma?: Forma;
  /** Mídia da biblioteca (modelo GLB ou imagem recortada). */
  midia?: string;
  pose?: Pose;
}

export interface FundoCena {
  tipo: 'cor' | 'imagem' | 'panorama' | 'mundo';
  cor?: string;
  midia?: string;
}

export interface DocumentoCena {
  objetos: ObjetoCena[];
  fundo: FundoCena;
  camera: { posicao: [number, number, number]; alvo: [number, number, number]; fov: number };
  luz: { intensidade: number; azimute: number; elevacao: number };
  chao: boolean;
  proporcao: string;
}

export function cenaVazia(): DocumentoCena {
  return {
    objetos: [],
    fundo: { tipo: 'cor', cor: '#d9dce3' },
    camera: { posicao: [0, 1.5, 4.5], alvo: [0, 1, 0], fov: 40 },
    luz: { intensidade: 2.2, azimute: 35, elevacao: 50 },
    chao: true,
    proporcao: '16:9',
  };
}

export const PROPORCOES: Record<string, [number, number]> = {
  '16:9': [1344, 768], '9:16': [768, 1344], '1:1': [1024, 1024], '4:3': [1152, 864], '3:2': [1216, 832], '21:9': [1536, 640],
};

type Modulos = {
  T: typeof THREE;
  Orbit: typeof OrbitControls;
  Transform: typeof TransformControls;
  carregarGlb: (url: string) => Promise<THREE.Object3D>;
};

interface Vivo {
  dados: ObjetoCena;
  obj: THREE.Object3D;
  juntas?: Map<Junta, THREE.Group>;
}

/**
 * O palco 3D sem Angular: cena, câmera com órbita, seleção por clique, gizmo de mover/girar/
 * escalar, poses dos bonecos junta por junta, fundo e o render final em PNG. A tela só conversa
 * com ele por métodos e pelos avisos aoSelecionar/aoMudar.
 */
export class PalcoMotor {
  aoSelecionar: (id: string | null, junta: Junta | null) => void = () => undefined;
  aoMudar: () => void = () => undefined;

  private m!: Modulos;
  private renderer!: THREE.WebGLRenderer;
  private cena!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private orbita!: OrbitControls;
  private gizmo!: TransformControls;
  private sol!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private grade!: THREE.GridHelper;
  private chao!: THREE.Mesh;
  private splat: THREE.Object3D | null = null;
  private readonly vivos = new Map<string, Vivo>();
  private doc: DocumentoCena = cenaVazia();
  private selecionado: string | null = null;
  private juntaSel: Junta | null = null;
  private modoPose = false;
  private quadro = 0;
  private obs: ResizeObserver | null = null;
  private urlDe: (midia: string) => { url: string; nome: string } | undefined = () => undefined;

  async iniciar(el: HTMLElement, urlDe: (midia: string) => { url: string; nome: string } | undefined): Promise<void> {
    this.urlDe = urlDe;
    const T = await import('three');
    const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
    const { TransformControls } = await import('three/examples/jsm/controls/TransformControls.js');
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    this.m = { T, Orbit: OrbitControls, Transform: TransformControls, carregarGlb: async (url) => (await loader.loadAsync(url)).scene };

    this.renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFShadowMap;
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;outline:none';
    el.appendChild(this.renderer.domElement);

    this.cena = new T.Scene();
    this.camera = new T.PerspectiveCamera(40, 1, 0.05, 2000);
    this.orbita = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbita.enableDamping = true;
    this.orbita.addEventListener('end', () => this.aoMudar());

    this.hemi = new T.HemisphereLight(0xffffff, 0x666677, 0.9);
    this.cena.add(this.hemi);
    this.sol = new T.DirectionalLight(0xffffff, 2.2);
    this.sol.castShadow = true;
    this.sol.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sol.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 0.5, far: 60 });
    this.cena.add(this.sol, this.sol.target);

    this.grade = new T.GridHelper(20, 40, 0x888899, 0xbbbbcc);
    (this.grade.material as THREE.Material).transparent = true;
    (this.grade.material as THREE.Material).opacity = 0.5;
    this.cena.add(this.grade);
    this.chao = new T.Mesh(new T.PlaneGeometry(60, 60), new T.ShadowMaterial({ opacity: 0.28 }));
    this.chao.rotation.x = -Math.PI / 2;
    this.chao.receiveShadow = true;
    this.cena.add(this.chao);

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.addEventListener('dragging-changed', (e) => (this.orbita.enabled = !(e as unknown as { value: boolean }).value));
    this.gizmo.addEventListener('objectChange', () => this.sincronizar());
    this.gizmo.addEventListener('mouseUp', () => this.aoMudar());
    this.cena.add(this.gizmo.getHelper());

    this.renderer.domElement.addEventListener('pointerdown', (e) => this.inicioClique = { x: e.clientX, y: e.clientY });
    this.renderer.domElement.addEventListener('pointerup', (e) => this.clicar(e));

    const ajustar = () => {
      const w = el.clientWidth || 640;
      const h = el.clientHeight || 400;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    this.obs = new ResizeObserver(ajustar);
    this.obs.observe(el);
    ajustar();
    const animar = () => {
      this.orbita.update();
      this.renderer.render(this.cena, this.camera);
      this.quadro = requestAnimationFrame(animar);
    };
    animar();
    await this.carregar(this.doc);
  }

  destruir(): void {
    cancelAnimationFrame(this.quadro);
    this.obs?.disconnect();
    this.gizmo?.dispose();
    this.orbita?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }

  // ---------- documento ----------

  documento(): DocumentoCena {
    const p = this.camera.position;
    const a = this.orbita.target;
    return {
      ...this.doc,
      objetos: [...this.vivos.values()].map((v) => structuredClone(v.dados)),
      camera: { posicao: [r3(p.x), r3(p.y), r3(p.z)], alvo: [r3(a.x), r3(a.y), r3(a.z)], fov: this.camera.fov },
    };
  }

  async carregar(doc: DocumentoCena): Promise<void> {
    for (const v of this.vivos.values()) this.cena.remove(v.obj);
    this.vivos.clear();
    this.selecionar(null);
    this.doc = structuredClone(doc);
    this.camera.position.set(...doc.camera.posicao);
    this.orbita.target.set(...doc.camera.alvo);
    this.camera.fov = doc.camera.fov;
    this.camera.updateProjectionMatrix();
    this.aplicarLuz();
    this.mostrarChao(doc.chao);
    await this.definirFundo(doc.fundo);
    for (const o of doc.objetos) await this.criar(o);
  }

  async adicionar(o: ObjetoCena): Promise<void> {
    await this.criar(o);
    this.selecionar(o.id);
    this.aoMudar();
  }

  remover(id: string): void {
    const v = this.vivos.get(id);
    if (!v) return;
    if (this.selecionado === id) this.selecionar(null);
    this.cena.remove(v.obj);
    this.vivos.delete(id);
    this.aoMudar();
  }

  duplicar(id: string, novoId: string): ObjetoCena | null {
    const v = this.vivos.get(id);
    if (!v) return null;
    const copia: ObjetoCena = { ...structuredClone(v.dados), id: novoId, nome: v.dados.nome + ' (cópia)' };
    copia.posicao = [copia.posicao[0] + 0.6, copia.posicao[1], copia.posicao[2]];
    void this.adicionar(copia);
    return copia;
  }

  objeto(id: string): ObjetoCena | null {
    return this.vivos.get(id)?.dados ?? null;
  }

  objetos(): ObjetoCena[] {
    return [...this.vivos.values()].map((v) => v.dados);
  }

  atualizar(id: string, mudancas: Partial<ObjetoCena>): void {
    const v = this.vivos.get(id);
    if (!v) return;
    Object.assign(v.dados, mudancas);
    this.aplicarTransformacao(v);
    if (mudancas.pose && v.juntas) aplicarPose(this.m.T, v.juntas, v.dados.pose ?? {});
    if (mudancas.cor) this.pintar(v.obj, mudancas.cor);
    this.aoMudar();
  }

  definirJunta(id: string, junta: Junta, graus: [number, number, number]): void {
    const v = this.vivos.get(id);
    if (!v?.juntas) return;
    v.dados.pose = { ...(v.dados.pose ?? {}), [junta]: graus };
    aplicarPose(this.m.T, v.juntas, v.dados.pose);
    this.aoMudar();
  }

  // ---------- seleção e gizmo ----------

  selecionar(id: string | null, junta: Junta | null = null): void {
    this.selecionado = id;
    this.juntaSel = junta;
    this.gizmo?.detach();
    const v = id ? this.vivos.get(id) : undefined;
    if (v) {
      const alvo = junta && v.juntas?.get(junta);
      if (alvo) {
        this.gizmo.setMode('rotate');
        this.gizmo.setSpace('local');
        this.gizmo.attach(alvo);
      } else {
        this.gizmo.setSpace('world');
        this.gizmo.attach(v.obj);
      }
    }
    this.aoSelecionar(v ? id : null, v ? junta : null);
  }

  modo(m: 'translate' | 'rotate' | 'scale'): void {
    if (this.juntaSel) return;
    this.gizmo.setMode(m);
  }

  /** No modo pose, clicar no boneco escolhe a junta (e o gizmo gira só ela). */
  definirModoPose(ligado: boolean): void {
    this.modoPose = ligado;
    if (!ligado && this.juntaSel) this.selecionar(this.selecionado, null);
  }

  enquadrar(): void {
    const T = this.m.T;
    const caixa = new T.Box3();
    for (const v of this.vivos.values()) caixa.expandByObject(v.obj);
    if (caixa.isEmpty()) return;
    const centro = caixa.getCenter(new T.Vector3());
    const tam = caixa.getSize(new T.Vector3()).length();
    const dir = this.camera.position.clone().sub(this.orbita.target).normalize();
    this.orbita.target.copy(centro);
    this.camera.position.copy(centro.clone().add(dir.multiplyScalar(Math.max(1.5, tam * 1.2))));
    this.aoMudar();
  }

  // ---------- ambiente ----------

  definirFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.aoMudar();
  }

  definirLuz(luz: DocumentoCena['luz']): void {
    this.doc.luz = luz;
    this.aplicarLuz();
    this.aoMudar();
  }

  mostrarChao(sim: boolean): void {
    this.doc.chao = sim;
    this.grade.visible = sim;
    this.chao.visible = sim;
  }

  definirProporcao(p: string): void {
    this.doc.proporcao = p;
    this.aoMudar();
  }

  async definirFundo(f: FundoCena): Promise<void> {
    const T = this.m.T;
    this.doc.fundo = f;
    if (this.splat) {
      this.cena.remove(this.splat);
      this.splat = null;
    }
    this.cena.background = new T.Color(f.cor ?? '#d9dce3');
    this.cena.environment = null;
    const fonte = f.midia ? this.urlDe(f.midia) : undefined;
    if (!fonte) return;
    if (f.tipo === 'imagem' || f.tipo === 'panorama') {
      const tex = await new T.TextureLoader().loadAsync(fonte.url);
      tex.colorSpace = T.SRGBColorSpace;
      if (f.tipo === 'panorama') {
        tex.mapping = T.EquirectangularReflectionMapping;
        this.cena.environment = tex;
      }
      this.cena.background = tex;
    } else if (f.tipo === 'mundo') {
      const { SplatMesh } = await import('@sparkjsdev/spark');
      const s = new SplatMesh({ url: fonte.url, fileName: fonte.nome });
      s.quaternion.set(1, 0, 0, 0);
      this.cena.add(s);
      this.splat = s;
    }
    this.aoMudar();
  }

  // ---------- render ----------

  /** A imagem final da câmera, sem grade nem gizmo, no tamanho da proporção escolhida. */
  async renderizar(): Promise<Blob> {
    const [w, h] = PROPORCOES[this.doc.proporcao] ?? PROPORCOES['16:9'];
    const helper = this.gizmo.getHelper();
    const visivelGizmo = helper.visible;
    const visivelGrade = this.grade.visible;
    helper.visible = false;
    this.grade.visible = false;
    const tamanho = this.renderer.getSize(new this.m.T.Vector2());
    const razao = this.renderer.getPixelRatio();
    const aspecto = this.camera.aspect;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.cena, this.camera);
    const blob = await new Promise<Blob>((ok, falha) => this.renderer.domElement.toBlob((b) => (b ? ok(b) : falha(new Error('render'))), 'image/png'));
    this.renderer.setPixelRatio(razao);
    this.renderer.setSize(tamanho.x, tamanho.y, false);
    this.camera.aspect = aspecto;
    this.camera.updateProjectionMatrix();
    helper.visible = visivelGizmo;
    this.grade.visible = visivelGrade;
    return blob;
  }

  // ---------- interno ----------

  private inicioClique: { x: number; y: number } | null = null;

  private clicar(e: PointerEvent): void {
    const ini = this.inicioClique;
    this.inicioClique = null;
    // Arrastar para girar a câmera não é clique.
    if (!ini || Math.hypot(e.clientX - ini.x, e.clientY - ini.y) > 4 || this.gizmo.dragging) return;
    const T = this.m.T;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ponteiro = new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const raio = new T.Raycaster();
    raio.setFromCamera(ponteiro, this.camera);
    const alvos = [...this.vivos.values()].map((v) => v.obj);
    const acerto = raio.intersectObjects(alvos, true)[0];
    if (!acerto) {
      this.selecionar(null);
      return;
    }
    let o: THREE.Object3D | null = acerto.object;
    let junta: Junta | null = null;
    while (o && !o.userData['id']) {
      junta ??= (o.userData['junta'] as Junta | undefined) ?? null;
      o = o.parent;
    }
    if (!o) return;
    this.selecionar(o.userData['id'] as string, this.modoPose ? junta : null);
  }

  private async criar(o: ObjetoCena): Promise<void> {
    const T = this.m.T;
    let obj: THREE.Object3D;
    let juntas: Map<Junta, THREE.Group> | undefined;
    switch (o.tipo) {
      case 'boneco': {
        const b = montarBoneco(T, o.cor ?? '#c9b8a6');
        obj = b.raiz;
        juntas = b.juntas;
        aplicarPose(T, juntas, o.pose ?? {});
        break;
      }
      case 'forma': {
        const geo = {
          cubo: () => new T.BoxGeometry(1, 1, 1), esfera: () => new T.SphereGeometry(0.5, 32, 20),
          cilindro: () => new T.CylinderGeometry(0.5, 0.5, 1, 32), cone: () => new T.ConeGeometry(0.5, 1, 32),
          plano: () => new T.PlaneGeometry(1, 1),
        }[o.forma ?? 'cubo']();
        const mesh = new T.Mesh(geo, new T.MeshStandardMaterial({ color: o.cor ?? '#9aa4b5', roughness: 0.6, side: o.forma === 'plano' ? T.DoubleSide : T.FrontSide }));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (o.forma !== 'plano') mesh.position.y = 0.5;
        obj = new T.Group().add(mesh);
        break;
      }
      case 'modelo': {
        const fonte = o.midia ? this.urlDe(o.midia) : undefined;
        const g = new T.Group();
        if (fonte) {
          const modelo = await this.m.carregarGlb(fonte.url);
          // Apoia no chão e normaliza para ~1 m: GLBs gerados vêm em escalas arbitrárias.
          const caixa = new T.Box3().setFromObject(modelo);
          const tam = caixa.getSize(new T.Vector3());
          const fator = 1 / Math.max(tam.x, tam.y, tam.z, 0.001);
          modelo.scale.multiplyScalar(fator);
          const c2 = new T.Box3().setFromObject(modelo);
          modelo.position.y -= c2.min.y;
          modelo.position.x -= (c2.min.x + c2.max.x) / 2;
          modelo.position.z -= (c2.min.z + c2.max.z) / 2;
          modelo.traverse((x) => { if ((x as THREE.Mesh).isMesh) { x.castShadow = true; x.receiveShadow = true; } });
          g.add(modelo);
        }
        obj = g;
        break;
      }
      case 'imagem': {
        const fonte = o.midia ? this.urlDe(o.midia) : undefined;
        const g = new T.Group();
        if (fonte) {
          const tex = await new T.TextureLoader().loadAsync(fonte.url);
          tex.colorSpace = T.SRGBColorSpace;
          const img = tex.image as { width: number; height: number };
          const aspecto = img.width / Math.max(1, img.height);
          const mesh = new T.Mesh(new T.PlaneGeometry(aspecto, 1), new T.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.05, side: T.DoubleSide }));
          mesh.position.y = 0.5;
          mesh.castShadow = true;
          g.add(mesh);
        }
        obj = g;
        break;
      }
    }
    obj.userData['id'] = o.id;
    const vivo: Vivo = { dados: structuredClone(o), obj, juntas };
    this.vivos.set(o.id, vivo);
    this.aplicarTransformacao(vivo);
    this.cena.add(obj);
  }

  private aplicarTransformacao(v: Vivo): void {
    const rad = this.m.T.MathUtils.degToRad;
    v.obj.position.set(...v.dados.posicao);
    v.obj.rotation.set(rad(v.dados.rotacao[0]), rad(v.dados.rotacao[1]), rad(v.dados.rotacao[2]));
    v.obj.scale.set(...v.dados.escala);
  }

  /** Gizmo mexeu: copia a transformação (ou a rotação da junta) para os dados do objeto. */
  private sincronizar(): void {
    const v = this.selecionado ? this.vivos.get(this.selecionado) : undefined;
    if (!v) return;
    const deg = this.m.T.MathUtils.radToDeg;
    if (this.juntaSel && v.juntas) {
      const g = v.juntas.get(this.juntaSel)!;
      v.dados.pose = { ...(v.dados.pose ?? {}), [this.juntaSel]: [r1(deg(g.rotation.x)), r1(deg(g.rotation.y)), r1(deg(g.rotation.z))] };
    } else {
      const o = v.obj;
      v.dados.posicao = [r3(o.position.x), r3(o.position.y), r3(o.position.z)];
      v.dados.rotacao = [r1(deg(o.rotation.x)), r1(deg(o.rotation.y)), r1(deg(o.rotation.z))];
      v.dados.escala = [r3(o.scale.x), r3(o.scale.y), r3(o.scale.z)];
    }
    this.aoSelecionar(this.selecionado, this.juntaSel);
  }

  private aplicarLuz(): void {
    const { intensidade, azimute, elevacao } = this.doc.luz;
    const rad = this.m.T.MathUtils.degToRad;
    const d = 12;
    this.sol.intensity = intensidade;
    this.hemi.intensity = 0.35 + intensidade * 0.25;
    this.sol.position.set(
      d * Math.cos(rad(elevacao)) * Math.sin(rad(azimute)),
      d * Math.sin(rad(elevacao)),
      d * Math.cos(rad(elevacao)) * Math.cos(rad(azimute)),
    );
  }

  private pintar(obj: THREE.Object3D, cor: string): void {
    obj.traverse((x) => {
      const mat = (x as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (mat && 'color' in mat && !mat.map) mat.color.set(cor);
    });
  }
}

function r3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function r1(v: number): number {
  return Math.round(v * 10) / 10;
}
