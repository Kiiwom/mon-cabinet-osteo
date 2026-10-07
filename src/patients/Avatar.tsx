/** Initiales du patient sur une pastille de couleur douce, toujours la même pour un même nom. */
const TEINTES = [
  ["#f6eacb", "#6e5212"],
  ["#e3ecf6", "#2f4f74"],
  ["#e3f0e8", "#1f4a33"],
  ["#f8e3ea", "#7a2d48"],
  ["#fce8d2", "#8a4710"],
] as const;

export function initiales(prenom: string, nom: string): string {
  const premiere = (t: string) => t.trim().charAt(0).toLocaleUpperCase("fr");
  return `${premiere(prenom)}${premiere(nom)}`;
}

export function Avatar({ prenom, nom, grand = false }: { prenom: string; nom: string; grand?: boolean }) {
  const somme = [...`${nom}${prenom}`].reduce((s, c) => s + c.charCodeAt(0), 0);
  const [fond, encre] = TEINTES[somme % TEINTES.length];
  return (
    <span className="avatar" data-grand={grand} style={{ background: fond, color: encre }} aria-hidden="true">
      {initiales(prenom, nom)}
    </span>
  );
}
