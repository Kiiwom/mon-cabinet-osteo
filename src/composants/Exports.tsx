/** Boutons d'export d'une liste : classeur Excel, CSV et, au besoin, impression. */
export function Exports({ desactive, excel, csv, imprimer }: { desactive: boolean; excel: () => void; csv: () => void; imprimer?: () => void }) {
  return (
    <div className="rangee rangee-centree sans-impression">
      <span className="discret">Exporter</span>
      <button type="button" className="bouton bouton-petit" disabled={desactive} onClick={excel}>
        Excel
      </button>
      <button type="button" className="bouton bouton-petit" disabled={desactive} onClick={csv}>
        CSV
      </button>
      {imprimer && (
        <button type="button" className="bouton bouton-petit" disabled={desactive} onClick={imprimer}>
          Imprimer ou PDF
        </button>
      )}
    </div>
  );
}
