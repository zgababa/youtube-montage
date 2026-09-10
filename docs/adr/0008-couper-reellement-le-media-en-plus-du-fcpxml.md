# 0008 — Couper réellement le média, en plus du FCPXML

## Statut

Accepté.

## Contexte

L'ADR 0001 a tranché l'export en faveur du FCPXML : le pipeline **décrit** la
coupe — une liste de points de montage — et c'est DaVinci Resolve qui
l'exécute à l'import. Aucun outil du pipeline ne produisait de fichier vidéo
effectivement coupé (issue #27).

C'est suffisant pour qui monte dans un NLE, et insuffisant pour tout le reste :
relire le cut avant de générer les scènes, l'envoyer à quelqu'un, le passer à
un outil qui ne lit pas le FCPXML. Ces usages demandent un fichier, pas une
description.

## Décision

Le projet porte **deux sorties de coupe, pas une** :

- `timeline.fcpxml` (`fcpxmlPath`) — la coupe **décrite**, ADR 0001 inchangée.
- `cut.mp4` (`cutVideoPath`) — la coupe **réalisée**.

Les deux se déduisent des mêmes `TimelineRun` via `keptRunsForProject`
(`lib/timeline.ts`), jamais de deux lectures concurrentes des `spans` : c'est
la seule garantie que le fichier coupé et le FCPXML décrivent le même montage.

La réalisation (`lib/cut.ts`) procède en deux temps :

1. **Extraction par run, ré-encodée** (`extractRange`, H.264/AAC). Les bornes
   tombent sur des frontières de mots, presque jamais sur une image clé ; une
   copie de flux repartirait de l'image clé précédente et réintroduirait en
   silence un fragment que le cleanup avait coupé. Le ré-encodage est ce qui
   rend le seek exact.
2. **Concaténation en copie de flux** (`concatFiles`). Les morceaux sortent
   normalisés — même fps, format de pixel, fréquence d'échantillonnage et
   nombre de canaux — donc il ne reste rien à ré-encoder.

## Conséquences

- Le ré-encodage est payé une fois, sur la seule durée conservée, pas sur la
  source entière ni deux fois.
- La normalisation dans `extractRange` n'est pas cosmétique : sans elle, un
  tournage multi-fichiers (prises numérotées) casse la concaténation en copie,
  qui ne sait pas réconcilier deux formats. Une source **sans piste audio**
  reste hors périmètre et ferait échouer la concaténation.
- `ffmpeg.ts` transcode désormais de la vidéo source, ce que son en-tête
  excluait. La source reste en lecture seule : rien n'est jamais réécrit
  par-dessus un fichier tourné.
- `cut.mp4` est écrit à la racine du projet, avec `timeline.fcpxml` et
  `shotlist.txt` — un livrable, pas un intermédiaire ; `exports/` reste réservé
  aux rendus de scènes.
- L'écriture passe par un `cut.mp4.partial` renommé en fin de course. Recouper
  après modification des spans est le cas nominal, et `ffmpeg -y` écrase dès le
  premier paquet : sans ça, un échec en cours de route laisserait un `cut.mp4`
  tronqué qui a toutes les apparences du cut courant.
- Cette ADR ne tranche pas **où** la coupe s'exécute dans le graphe du pipeline
  ni si elle mérite un gate : `cutMedia` est pour l'instant appelable, pas
  appelé.
