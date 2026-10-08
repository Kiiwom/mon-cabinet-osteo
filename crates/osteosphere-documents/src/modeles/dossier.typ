// Dossier du patient, pour une demande d'accès. Les valeurs arrivent en JSON et s'affichent telles
// quelles : un texte contenant « * » ou « # » ne change pas la mise en page. Le texte mis en forme
// arrive sous forme de document de l'éditeur (paragraphes, intertitres, listes ; gras, italique, souligné).
#let d = json(bytes(sys.inputs.donnees))
#let hab = d.habillage
#let accent = rgb(hab.couleur)
#let discret = rgb("#555555")
#let filet = rgb("#dddddd")

#set document(title: d.titre + " · " + d.patient, author: d.praticien.nom_complet)
#set text(font: "Figtree", size: 10.5pt, lang: "fr", fill: rgb("#222222"))
#set par(leading: 0.6em, spacing: 0.75em)
#set list(indent: 0.4em, body-indent: 0.5em)
#set enum(indent: 0.4em, body-indent: 0.5em)
#set page(
  paper: "a4",
  margin: (x: 2cm, top: 2cm, bottom: 2.4cm),
  footer: context [
    #line(length: 100%, stroke: 0.5pt + filet)
    #text(size: 8pt, fill: discret)[#d.pied #h(1fr) Page #counter(page).display() sur #counter(page).final().first()]
  ],
)

#let enfants(n) = n.at("content", default: ())

#let en_ligne(n) = {
  let c = if n.type == "text" { n.text } else if n.type == "hardBreak" { linebreak() } else { [] }
  for m in n.at("marks", default: ()) {
    if m.type == "bold" { c = strong(c) } else if m.type == "italic" { c = emph(c) } else if m.type == "underline" { c = underline(c) }
  }
  c
}

#let bloc(n) = {
  if n.type == "paragraph" {
    enfants(n).map(en_ligne).join()
    parbreak()
  } else if n.type == "heading" {
    text(weight: "bold", enfants(n).map(en_ligne).join())
    parbreak()
  } else if n.type == "bulletList" {
    list(..enfants(n).map(i => enfants(i).map(bloc).join()))
  } else if n.type == "orderedList" {
    enum(..enfants(n).map(i => enfants(i).map(bloc).join()))
  }
}

#let identite = [
  #text(size: 12.5pt, weight: "bold", d.praticien.nom_complet) \
  #d.praticien.profession
  #for ligne in d.praticien.lignes [ \ #ligne ]
]
#if hab.logo == "" {
  grid(columns: (1fr, auto), gutter: 1em, identite, align(right + bottom, text(fill: discret, d.lieu_date)))
} else if hab.logo_a_droite {
  grid(columns: (1fr, auto), gutter: 1em, identite, align(right + top, image(hab.logo, height: 1.8cm)))
  align(right, text(fill: discret, d.lieu_date))
} else {
  grid(columns: (auto, 1fr, auto), gutter: 1.2em, align(top, image(hab.logo, height: 1.8cm)), identite, align(right + bottom, text(fill: discret, d.lieu_date)))
}

#v(1.2em)
#line(length: 100%, stroke: 0.8pt + accent)
#v(-0.3em)
#align(center, text(size: 13pt, weight: "bold", tracking: 0.02em, fill: accent, d.titre))
#v(-0.5em)
#align(center, text(fill: discret, d.sous_titre))
#v(-0.3em)
#line(length: 100%, stroke: 0.8pt + accent)
#v(0.6em)

#text(fill: discret)[Patient] #h(0.4em) #text(weight: "semibold", d.patient)
#if d.naissance != "" [ #h(0.4em) #text(fill: discret, d.naissance) ]

#for s in d.sections {
  if s.genre == "rubrique" {
    v(1.2em)
    text(size: 12pt, weight: "bold", fill: accent, s.libelle)
    v(-0.2em)
    line(length: 100%, stroke: 0.8pt + accent)
  } else if s.genre == "seance" {
    block(above: 1.2em, below: 0.4em, sticky: true, width: 100%)[
      #text(size: 11pt, weight: "bold", s.libelle)
      #v(-0.4em)
      #line(length: 100%, stroke: 0.5pt + filet)
    ]
  } else if s.genre == "intertitre" {
    block(above: 0.9em, sticky: true, text(weight: "bold", fill: accent, s.libelle))
  } else if s.genre == "lignes" {
    block(above: 0.8em, width: 100%, grid(
      columns: (auto, 1fr),
      column-gutter: 1.2em,
      row-gutter: 0.55em,
      ..s.lignes.map(l => (text(fill: discret, l.at(0)), l.at(1))).flatten(),
    ))
  } else if s.genre == "liste" {
    block(above: 0.8em, breakable: true, width: 100%)[
      #if s.libelle != "" [ #text(weight: "bold", s.libelle) #v(-0.35em) ]
      #list(..s.elements)
    ]
  } else {
    block(above: 0.8em, breakable: true, width: 100%)[
      #if s.libelle != "" [ #text(weight: "bold", s.libelle) #v(-0.35em) ]
      #if s.genre == "riche" { for b in s.blocs { bloc(b) } } else { s.texte }
    ]
  }
}

#v(2em)
#align(right)[
  #if hab.signature != "" { image(hab.signature, height: 1.6cm) }
  #text(weight: "semibold", d.signataire) \
  #text(fill: discret, d.profession)
]
