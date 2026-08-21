# 0003 — Erreur explicite sur un multi-caméra ambigu

## Statut

Accepté.

## Contexte

`assignRoles`/`autoPair` (`src/mastra/lib/media.ts`) résolvent le cas
courant — une caméra, un micro séparé — en pointant `voices` du fichier micro
vers la caméra qu'il sert. Ce qu'ils ne résolvent pas : plusieurs caméras
simultanées sans micro séparé identifiable. Dans ce cas, chaque fichier reste
`transcribe: true` avec `voices: null`, car rien n'indique à l'appariement
quel fichier fait autorité.

Mais cette même forme — plusieurs fichiers `transcribe: true` sans `voices`
— décrit aussi un tournage délibérément séquentiel : plusieurs fichiers
numérotés (`01 - `, `02 - `, convention lue par `isNumbered`), chacun avec son
propre son de tournage, sans micro séparé. C'est exactement le cas réel de
l'utilisateur (6 fichiers vidéo séquentiels). Un garde-fou qui refuserait
purement sur le nombre de fichiers ambigus casserait ce cas réel.

## Décision

Le garde-fou (`assertSingleTranscriptionSource`, appelé par `buildKeptRuns`
dans `src/mastra/lib/timeline.ts`) échoue explicitement seulement quand
plusieurs fichiers `transcribe: true` sans `voices` existent **et qu'ils ne
sont pas tous couverts par la convention de numérotation** (`isNumbered`,
`src/mastra/lib/media.ts`). La numérotation est la seule affirmation
explicite, déjà présente dans le code, que l'utilisateur fait sur l'ordre des
fichiers (`compareForScript`, `usesNumbering`) — s'appuyer dessus ici est une
réutilisation, pas une nouvelle règle.

Sans cette convention, l'ordre entre fichiers n'est qu'un ordre de tri, pas
un ordre temporel réel — enchaîner leurs segments gardés bout à bout comme
s'ils étaient séquentiels produirait une timeline qui s'importe proprement
dans DaVinci et qui est simplement fausse, ce qui est pire que refuser
l'export.

## Conséquences

- Le cas des 6 fichiers numérotés de l'utilisateur passe sans erreur.
- Un multi-caméra non numéroté (`cam-left.mp4`, `cam-right.mp4`, sans micro
  séparé identifié) échoue explicitement au step `fcpxml`, avec un message
  qui nomme les fichiers en cause.
- La sélection/dédoublonnage de prises multiples d'un même passage reste hors
  périmètre (différé à un chantier séparé, cf. issue #1) — ce garde-fou ne
  traite que l'ambiguïté d'ordre, pas l'ambiguïté de contenu dupliqué.
