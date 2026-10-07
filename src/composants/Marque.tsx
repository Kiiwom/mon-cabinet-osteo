export function LogoOsteosphere({ taille = 22 }: { taille?: number }) {
  return (
    <svg
      width={taille}
      height={taille}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#33291F"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3c-3 3-3 6 0 9s3 6 0 9" />
      <path d="M7 7h10" />
      <path d="M7 17h10" />
    </svg>
  );
}

export function Marque({ sousTitre = "logiciel libre" }: { sousTitre?: string }) {
  return (
    <div className="marque">
      <div className="marque-logo">
        <LogoOsteosphere />
      </div>
      <div className="marque-nom">
        <strong>Osteosphere</strong>
        <span>{sousTitre}</span>
      </div>
    </div>
  );
}
