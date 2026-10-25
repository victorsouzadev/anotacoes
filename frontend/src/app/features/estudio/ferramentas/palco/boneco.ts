import type * as THREE from 'three';

/**
 * Boneco articulado do palco (o "manequim" do ArtCraft): juntas em hierarquia, com rotação em
 * graus por junta. A pose é só um mapa junta → [x, y, z], que é o que a cena salva.
 */
export type Junta =
  | 'quadril' | 'tronco' | 'peito' | 'pescoco' | 'cabeca'
  | 'ombroE' | 'cotoveloE' | 'maoE' | 'ombroD' | 'cotoveloD' | 'maoD'
  | 'coxaE' | 'joelhoE' | 'peE' | 'coxaD' | 'joelhoD' | 'peD';

export type Pose = Partial<Record<Junta, [number, number, number]>>;

export const JUNTAS: { id: Junta; nome: string; pai: Junta | null }[] = [
  { id: 'quadril', nome: 'Quadril', pai: null },
  { id: 'tronco', nome: 'Tronco', pai: 'quadril' },
  { id: 'peito', nome: 'Peito', pai: 'tronco' },
  { id: 'pescoco', nome: 'Pescoço', pai: 'peito' },
  { id: 'cabeca', nome: 'Cabeça', pai: 'pescoco' },
  { id: 'ombroE', nome: 'Ombro esquerdo', pai: 'peito' },
  { id: 'cotoveloE', nome: 'Cotovelo esquerdo', pai: 'ombroE' },
  { id: 'maoE', nome: 'Mão esquerda', pai: 'cotoveloE' },
  { id: 'ombroD', nome: 'Ombro direito', pai: 'peito' },
  { id: 'cotoveloD', nome: 'Cotovelo direito', pai: 'ombroD' },
  { id: 'maoD', nome: 'Mão direita', pai: 'cotoveloD' },
  { id: 'coxaE', nome: 'Coxa esquerda', pai: 'quadril' },
  { id: 'joelhoE', nome: 'Joelho esquerdo', pai: 'coxaE' },
  { id: 'peE', nome: 'Pé esquerdo', pai: 'joelhoE' },
  { id: 'coxaD', nome: 'Coxa direita', pai: 'quadril' },
  { id: 'joelhoD', nome: 'Joelho direito', pai: 'coxaD' },
  { id: 'peD', nome: 'Pé direito', pai: 'joelhoD' },
];

/** Posição de cada junta em relação à junta mãe (metros; boneco de 1,75 m em pé). */
const OFFSET: Record<Junta, [number, number, number]> = {
  quadril: [0, 0.95, 0], tronco: [0, 0.12, 0], peito: [0, 0.22, 0], pescoco: [0, 0.22, 0], cabeca: [0, 0.1, 0],
  ombroE: [0.19, 0.17, 0], cotoveloE: [0, -0.29, 0], maoE: [0, -0.26, 0],
  ombroD: [-0.19, 0.17, 0], cotoveloD: [0, -0.29, 0], maoD: [0, -0.26, 0],
  coxaE: [0.1, -0.05, 0], joelhoE: [0, -0.43, 0], peE: [0, -0.43, 0],
  coxaD: [-0.1, -0.05, 0], joelhoD: [0, -0.43, 0], peD: [0, -0.43, 0],
};

/** Segmento desenhado a partir de cada junta (comprimento, raio), apontando para baixo. */
// O comprimento de cada osso é a distância até a junta filha: braços e pernas encostam no cotovelo
// e no joelho sem vão. Tronco e peito se sobrepõem um pouco, como um manequim de madeira.
const OSSO: Partial<Record<Junta, [number, number]>> = {
  tronco: [0.3, 0.12], peito: [0.32, 0.15], pescoco: [0.12, 0.045],
  ombroE: [0.29, 0.05], cotoveloE: [0.26, 0.042], ombroD: [0.29, 0.05], cotoveloD: [0.26, 0.042],
  coxaE: [0.43, 0.075], joelhoE: [0.43, 0.058], coxaD: [0.43, 0.075], joelhoD: [0.43, 0.058],
};

export const POSES: { id: string; nome: string; pose: Pose }[] = [
  { id: 'pe', nome: 'Em pé', pose: { ombroE: [0, 0, 8], ombroD: [0, 0, -8] } },
  { id: 't', nome: 'Braços abertos', pose: { ombroE: [0, 0, 88], ombroD: [0, 0, -88] } },
  {
    id: 'andando', nome: 'Andando',
    pose: { coxaE: [-25, 0, 0], joelhoE: [10, 0, 0], coxaD: [20, 0, 0], joelhoD: [25, 0, 0], ombroE: [25, 0, 6], cotoveloE: [-15, 0, 0], ombroD: [-25, 0, -6], cotoveloD: [-20, 0, 0] },
  },
  {
    id: 'correndo', nome: 'Correndo',
    pose: { tronco: [12, 0, 0], coxaE: [-60, 0, 0], joelhoE: [70, 0, 0], coxaD: [35, 0, 0], joelhoD: [80, 0, 0], ombroE: [50, 0, 10], cotoveloE: [-90, 0, 0], ombroD: [-45, 0, -10], cotoveloD: [-90, 0, 0] },
  },
  {
    id: 'sentado', nome: 'Sentado',
    pose: { quadril: [0, 0, 0], coxaE: [-90, 0, 4], joelhoE: [90, 0, 0], coxaD: [-90, 0, -4], joelhoD: [90, 0, 0], ombroE: [-10, 0, 12], cotoveloE: [-40, 0, 0], ombroD: [-10, 0, -12], cotoveloD: [-40, 0, 0] },
  },
  {
    id: 'apontando', nome: 'Apontando',
    pose: { ombroD: [-85, 0, -10], cotoveloD: [-5, 0, 0], ombroE: [0, 0, 8], cabeca: [0, -20, 0] },
  },
  {
    id: 'acenando', nome: 'Acenando',
    pose: { ombroE: [0, 0, 150], cotoveloE: [0, 0, 30], ombroD: [0, 0, -8], cabeca: [0, 15, 5] },
  },
  {
    id: 'pensando', nome: 'Pensando',
    pose: { ombroD: [-40, 0, -25], cotoveloD: [-130, 0, 0], cabeca: [10, -10, 8], ombroE: [-10, 0, 25], cotoveloE: [-80, 0, 0] },
  },
];

/** Pose pronta pelo id (cópia, para editar sem mexer no modelo). */
export function poseDe(id: string): Pose {
  const p = POSES.find((x) => x.id === id)?.pose ?? {};
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, [...v]])) as Pose;
}

/** Junta-se uma pose a outra (a segunda vence), limitando cada eixo a ±180°. */
export function juntarPoses(a: Pose, b: Pose): Pose {
  const r: Pose = { ...a };
  for (const [k, v] of Object.entries(b) as [Junta, [number, number, number]][]) {
    r[k] = v.map((g) => Math.max(-180, Math.min(180, g))) as [number, number, number];
  }
  return r;
}

/**
 * Monta o boneco com o Three.js já carregado (o módulo é importado só quando o palco abre). Cada
 * junta é um Group com `userData.junta`; os ossos são cápsulas, filhos da junta.
 */
export function montarBoneco(T: typeof THREE, cor: string): { raiz: THREE.Group; juntas: Map<Junta, THREE.Group> } {
  const raiz = new T.Group();
  raiz.userData['boneco'] = true;
  const material = new T.MeshStandardMaterial({ color: cor, roughness: 0.55, metalness: 0.05 });
  const juntas = new Map<Junta, THREE.Group>();
  for (const j of JUNTAS) {
    const g = new T.Group();
    g.name = j.id;
    g.userData['junta'] = j.id;
    g.position.set(...OFFSET[j.id]);
    (j.pai ? juntas.get(j.pai)! : raiz).add(g);
    juntas.set(j.id, g);
    const osso = OSSO[j.id];
    if (osso) {
      const [comp, raio] = osso;
      const m = new T.Mesh(new T.CapsuleGeometry(raio, Math.max(0.01, comp - raio * 2), 6, 12), material);
      // Tronco, peito e pescoço crescem para cima; braços e pernas, para baixo.
      const sobe = j.id === 'tronco' || j.id === 'peito' || j.id === 'pescoco';
      m.position.y = sobe ? comp / 2 : -comp / 2;
      m.castShadow = true;
      m.userData['junta'] = j.id;
      g.add(m);
    }
  }
  const cabeca = new T.Mesh(new T.SphereGeometry(0.11, 24, 16), material);
  cabeca.scale.set(0.9, 1.1, 1);
  cabeca.position.y = 0.11;
  cabeca.castShadow = true;
  cabeca.userData['junta'] = 'cabeca';
  juntas.get('cabeca')!.add(cabeca);
  // Nariz: mostra para onde o boneco olha.
  const nariz = new T.Mesh(new T.ConeGeometry(0.025, 0.06, 10), material);
  nariz.rotation.x = Math.PI / 2;
  nariz.position.set(0, 0.11, 0.105);
  juntas.get('cabeca')!.add(nariz);
  for (const lado of ['E', 'D'] as const) {
    const mao = new T.Mesh(new T.SphereGeometry(0.045, 12, 10), material);
    mao.scale.set(0.8, 1.3, 0.5);
    mao.position.y = -0.05;
    mao.userData['junta'] = `mao${lado}`;
    juntas.get(`mao${lado}`)!.add(mao);
    const pe = new T.Mesh(new T.BoxGeometry(0.1, 0.06, 0.24), material);
    pe.position.set(0, -0.03, 0.06);
    pe.castShadow = true;
    pe.userData['junta'] = `pe${lado}`;
    juntas.get(`pe${lado}`)!.add(pe);
  }
  const quadril = new T.Mesh(new T.CapsuleGeometry(0.13, 0.12, 6, 12), material);
  quadril.rotation.z = Math.PI / 2;
  quadril.castShadow = true;
  quadril.userData['junta'] = 'quadril';
  juntas.get('quadril')!.add(quadril);
  return { raiz, juntas };
}

export function aplicarPose(T: typeof THREE, juntas: Map<Junta, THREE.Group>, pose: Pose): void {
  const rad = T.MathUtils.degToRad;
  for (const [id, g] of juntas) {
    const r = pose[id] ?? [0, 0, 0];
    g.rotation.set(rad(r[0]), rad(r[1]), rad(r[2]));
  }
}
