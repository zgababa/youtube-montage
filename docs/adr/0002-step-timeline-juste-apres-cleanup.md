# 0002 — Le step timeline juste après cleanup

## Statut

Accepté.

## Contexte

Le pipeline enchaîne dix steps, de `scan` à `shotlist`. La génération de
scènes b-roll (`scenarios` → `generate` → `review` → `export`) est la partie
coûteuse : un appel modèle par scène, plus le rendu Chromium pour chaque
validation. L'export FCPXML de cette v1 ne dépend que de `spans` — approuvé
au gate `cleanup` — pas des scènes.

## Décision

Le nouveau step (`id: "fcpxml"`) est placé **juste après `cleanupStep`, avant
`scenariosStep`** — pas en fin de chaîne, où il aurait fallu attendre la
génération complète des scènes pour obtenir un fichier qui ne les concerne
pas.

## Conséquences

- Un utilisateur qui n'a besoin que du cut monté obtient `timeline.fcpxml`
  dès le gate `cleanup` franchi, sans payer le coût de la génération de
  scènes.
- Le step relit `cleanupApprovedAt` lui-même plutôt que de recevoir un
  drapeau de `cleanupStep` — chaque step ne reçoit que `{ projectPath }` entre
  eux (tout le reste vit dans `project.json`), donc dupliquer cette lecture
  est le patron existant, pas une exception.
- Quand les scènes b-roll seront ajoutées à l'export (itération suivante),
  `fcpxmlPath` pourra soit être régénéré par un step supplémentaire après
  `review`, soit ce step pourra être révisé — cette ADR ne préjuge pas de ce
  choix.
