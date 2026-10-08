// Facture et avoir d'après la maquette 6. Toutes les valeurs arrivent déjà mises en forme, en JSON :
// elles s'affichent telles quelles, un nom contenant « * » ou « # » ne change pas la mise en page.
#let d = json(bytes(sys.inputs.donnees))
#let hab = d.habillage
#let couleur = rgb(hab.couleur)
#let discret = rgb("#555555")
#let filet = rgb("#dddddd")

#set document(title: d.titre + " " + d.numero, author: d.praticien.nom_complet)
#set text(font: "Figtree", size: 10pt, lang: "fr", fill: rgb("#222222"))
#set par(leading: 0.55em)
#set page(
  paper: "a4",
  margin: (x: 2cm, top: 2cm, bottom: if d.mentions_libres != "" { 3cm } else { 2.4cm }),
  // Filigrane centré par Typst ; sa taille le garde sur une seule ligne.
  background: if d.filigrane != "" {
    rotate(-35deg, text(size: 36pt, weight: "bold", fill: rgb("#ece4d6"), d.filigrane))
  },
  footer: [
    #line(length: 100%, stroke: 0.5pt + filet)
    #if d.mentions_libres != "" [
      #align(center, text(size: 7.5pt, fill: discret, d.mentions_libres))
      #v(-0.5em)
    ]
    #align(center, text(size: 8pt, fill: discret, d.mentions))
  ],
)

#let identite = [
  #text(size: 12.5pt, weight: "bold", d.praticien.nom_complet) \
  #d.praticien.profession
  #for ligne in d.praticien.lignes [ \ #ligne ]
]
#if hab.logo == "" {
  identite
} else if hab.logo_a_droite {
  grid(columns: (1fr, auto), gutter: 1em, identite, align(right + top, image(hab.logo, height: 1.8cm)))
} else {
  grid(columns: (auto, 1fr), gutter: 1.2em, align(top, image(hab.logo, height: 1.8cm)), identite)
}

#v(1.4em)
#line(length: 100%, stroke: 0.8pt + couleur)
#v(-0.3em)
#align(center, text(size: 12.5pt, weight: "bold", tracking: 0.02em, fill: couleur, d.titre + " N° " + d.numero))
#v(-0.3em)
#line(length: 100%, stroke: 0.8pt + couleur)
#if d.mention != "" [
  #align(center, text(size: 9pt, fill: discret, d.mention))
]
#if d.annulation != "" [
  #align(center, text(size: 9pt, weight: "semibold", fill: rgb("#9a3a2a"), d.annulation))
]
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
#if d.remise {
  table(
    columns: (1fr, auto, auto, auto, auto),
    align: (left, right, right, right, right),
    stroke: (x, y) => if y > 0 { (bottom: 0.5pt + filet) },
    fill: (x, y) => if y == 0 { rgb("#f1f1f1") },
    inset: (x: 8pt, y: 7pt),
    table.header([*Désignation*], [*Qté*], [*Prix unitaire*], [*Remise*], [*Total*]),
    ..d.lignes.map(l => (l.designation, l.quantite, l.prix, l.remise, l.total)).flatten(),
  )
} else {
  table(
    columns: (1fr, auto, auto, auto),
    align: (left, right, right, right),
    stroke: (x, y) => if y > 0 { (bottom: 0.5pt + filet) },
    fill: (x, y) => if y == 0 { rgb("#f1f1f1") },
    inset: (x: 8pt, y: 7pt),
    table.header([*Désignation*], [*Qté*], [*Prix unitaire*], [*Total*]),
    ..d.lignes.map(l => (l.designation, l.quantite, l.prix, l.total)).flatten(),
  )
}

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
    ..d.totaux.map(t => (t.libelle, if t.fort { text(weight: "bold", t.valeur) } else { t.valeur })).flatten(),
  ),
)

#v(1fr)
#align(right)[
  #d.lieu_date
  #v(0.5em)
  #if hab.signature != "" {
    image(hab.signature, height: 1.6cm)
    text(size: 9pt, d.signataire)
  } else {
    text(size: 16pt, style: "italic", fill: rgb("#2b3f6b"), d.signataire)
  }
  #h(1.2em)
]
