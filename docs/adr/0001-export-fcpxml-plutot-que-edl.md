# 0001 — Export FCPXML plutôt que EDL

## Statut

Accepté.

## Contexte

Le fork doit fermer l'écart identifié en amont : aucun export de timeline
vers l'NLE n'existe, l'utilisateur replace tout à la main dans DaVinci
Resolve 21. Cette v1 n'a besoin que d'une timeline mono-piste (vidéo + audio
embarqué, pas de scènes b-roll) — un besoin qu'un simple EDL (CMX3600) aurait
largement couvert, avec un format plus simple et plus ancien/éprouvé.

Mais une itération suivante ajoutera les scènes b-roll comme clips connectés
(`lane="1"`, alpha, mapping temps-source → temps-timeline) — un besoin qu'EDL
ne sait pas exprimer du tout (pas de pistes secondaires, pas d'alpha).

## Décision

FCPXML dès cette v1, même si elle n'utilise que la spine (piste principale).
Un seul générateur (`src/mastra/lib/fcpxml.ts`) est construit et fiabilisé
sur toute la durée du projet ; l'itération scènes étendra ce même générateur
plutôt que d'en écrire un second à partir d'un format différent.

**Version et dialecte, vérifiés par recherche ciblée plutôt que supposés**
(l'importeur FCPXML de DaVinci Resolve a toujours suivi son propre
sous-ensemble de la spec Apple, en retard sur les dernières versions) :

- `<fcpxml version="1.9">`. Plusieurs sources indépendantes convergent sur le
  fait que c'est la version que l'importeur de Resolve parse le plus
  fiablement (confirmé Resolve 17 à 19 ; 1.10 fonctionne aussi depuis Resolve
  18 ; 1.11 et au-delà a des problèmes d'import documentés). Rien dans les
  notes de version de Resolve 20/21 n'indique un changement de cette couche
  d'interchange — 1.9 est le choix le plus sûr en l'absence de confirmation
  directe pour la version 21.
- Toutes les valeurs temporelles (`frameDuration`, `duration`, `offset`,
  `start`) sont des rationnels exacts (`"num/den" + "s"`), jamais des
  flottants — obligatoire pour les cadences NTSC (23.976, 29.97, 59.94 fps)
  où la seconde décimale n'est pas représentable exactement (une frame à
  23.976 fps est exactement `1001/24000s`, pas `0.041708333...s`).

## Conséquences

- Un seul générateur à maintenir plutôt que deux formats différents entre v1
  (cut) et v2 (scènes).
- Le choix de version FCPXML devra être revalidé (import réel dans DaVinci
  Resolve 21, cf. issue #1 « Vérification de bout en bout ») avant d'être
  considéré comme confirmé plutôt que comme la meilleure estimation
  disponible par recherche documentaire.
- EDL reste plus simple pour un export mono-piste seul ; ce n'est plus une
  option envisagée pour ce projet une fois FCPXML choisi comme générateur
  unique.
