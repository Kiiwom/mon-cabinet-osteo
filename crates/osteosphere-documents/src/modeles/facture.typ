// Facture d'après la maquette 6. Toutes les valeurs arrivent déjà mises en forme, en JSON :
// elles s'affichent telles quelles, un nom contenant « * » ou « # » ne change pas la mise en page.
#let d = json(bytes(sys.inputs.donnees))
#let discret = rgb("#555555")
#let filet = rgb("#dddddd")

#set document(title: "Facture " + d.numero, author: d.praticien.nom_complet)
#set text(font: "Figtree", size: 10pt, lang: "fr", fill: rgb("#222222"))
#set par(leading: 0.55em)
#set page(
  paper: "a4",
  margin: (x: 2cm, top: 2cm, bottom: 2.4cm),
  // Filigrane centré par Typst ; sa taille le garde sur une seule ligne.
  background: if d.essai {
    rotate(-35deg, text(size: 40pt, weight: "bold", fill: rgb("#ece4d6"))[ESSAI — SANS VALEUR])
  },
  footer: [
    #line(length: 100%, stroke: 0.5pt + filet)
    #align(center, text(size: 8pt, fill: discret, d.mentions))
  ],
)

#grid(
  columns: (1fr, auto),
  gutter: 1em,
  [
    #text(size: 12.5pt, weight: "bold", d.praticien.nom_complet) \
    #d.praticien.profession
    #for ligne in d.praticien.lignes [ \ #ligne ]
  ],
  box(
    width: 2.3cm,
    height: 2.3cm,
    stroke: (paint: rgb("#cfc2ae"), dash: "dashed"),
    radius: 4pt,
    align(center + horizon, text(size: 8pt, fill: rgb("#6b5b4b"))[Logo]),
  ),
)

#v(1.4em)
#line(length: 100%, stroke: 0.8pt)
#v(-0.3em)
#align(center, text(size: 12.5pt, weight: "bold", tracking: 0.02em)[FACTURE N° #d.numero])
#v(-0.3em)
#line(length: 100%, stroke: 0.8pt)
#v(1em)

#grid(
  columns: (1fr, 1fr),
  gutter: 1em,
  [
    Date d’émission : #d.emission
    #if d.seance != "" [ \ #d.seance ]
  ],
  [
    #text(fill: discret)[À l’attention de] \
    #text(weight: "semibold", d.destinataire.nom)
    #for ligne in d.destinataire.lignes [ \ #ligne ]
  ],
)

#v(1.6em)
#table(
  columns: (1fr, auto, auto, auto),
  align: (left, right, right, right),
  stroke: (x, y) => if y > 0 { (bottom: 0.5pt + filet) },
  fill: (x, y) => if y == 0 { rgb("#f1f1f1") },
  inset: (x: 8pt, y: 7pt),
  table.header([*Désignation*], [*Qté*], [*Prix unitaire*], [*Total*]),
  ..d.lignes.map(l => (l.designation, l.quantite, l.prix, l.total)).flatten(),
)

#v(1em)
#grid(
  columns: (1fr, 6.5cm),
  gutter: 1.5em,
  text(fill: rgb("#444444"))[
    #for ligne in d.reglements [ #ligne \ ]
    #if d.commentaire != "" [ #v(0.6em) #d.commentaire ]
  ],
  grid(
    columns: (1fr, auto),
    row-gutter: 0.6em,
    [Total], text(weight: "bold", d.total),
    [Réglé], d.regle,
    [Reste à régler], text(weight: "bold", d.reste),
  ),
)

#v(1fr)
#align(right)[
  #d.lieu_date
  #v(0.5em)
  #text(size: 16pt, style: "italic", fill: rgb("#2b3f6b"), d.signataire)
  #h(1.2em)
]
