# Montage assisté

Vocabulaire partagé pour les instructions qu’un créateur adresse au monteur
dans sa prise de parole et pour les décisions qui en découlent.

## Commandes de montage

**Commande de montage**:
Une enveloppe vocale réservée, ouverte et fermée par le même marqueur, que le
créateur prononce pour demander une opération éditoriale sur les mots qu’elle
contient. Les bornes n’appartiennent pas au contenu final et sont retirées du
montage lorsqu’elles sont reconnues.

_Avoid_: mot-clé, commentaire, métadonnée parlée

**Corps de commande**:
Les mots prononcés entre les deux bornes d’une commande de montage. Ils
portent le contenu de la demande, par exemple le texte d’un titre, et leur
traitement audio dépend du type de commande.

_Avoid_: phrase cible, texte de commande

**Type de commande**:
Un membre du catalogue explicite des commandes de montage, comme `TITRE` ou
`ZOOM`, avec une sémantique et un comportement éditorial propres.

_Avoid_: mot-clé libre, effet générique

**Intention de montage**:
Une demande éditoriale normalisée issue soit d’une commande vocale, soit d’une
annotation manuelle, et destinée à produire ou corriger un élément du plan.

_Avoid_: tag brut, suggestion IA

**Annotation manuelle**:
Une intention de montage ajoutée pendant la revue en l’attachant à une
sélection de segments ou de section, sans modifier le texte du transcript.

_Avoid_: édition du transcript, commande tapée

**Intention orpheline**:
Une intention explicite dont les segments d’ancrage n’existent plus après une
nouvelle version du cleanup. Elle reste visible comme conflit jusqu’à ce que
la revue la rattache ou la supprime.

_Avoid_: intention déplacée, intention ignorée

## Éléments visuels

**Scène B-roll**:
Une animation générée pour illustrer une fenêtre du script et ajoutée comme
overlay à la timeline. Elle enrichit l’image source sans remplacer par défaut
le contenu audio ou la piste principale.

_Avoid_: commande de montage, écran titre

## Planification éditoriale

**Document de montage**:
Le document persistant qui se complète à chaque étape du workflow : script
nettoyé, structure, effets proposés, rendus et éléments placés dans la
timeline. Il décrit simplement quel effet doit apparaître à quel moment et
référence les segments, assets et exports sans dupliquer leur contenu.

_Avoid_: blueprint, transcript enrichi, timeline seule

**Script approuvé**:
La version du script issue des spans conservés après la revue du cleanup. Les
intentions et éléments du document de montage s’y ancrent; les spans coupés ne sont pas
des cibles valides pour une annotation manuelle.

_Avoid_: transcript brut, script réécrit

**Composé**:
État d’un élément dont le fichier est référencé dans l’export FCPXML du projet.
Ce terme ne prétend pas que l’élément a été importé ou conservé dans le NLE.

_Avoid_: importé, accepté dans DaVinci, rendu

**Plan éditorial**:
Une partie du document de montage produite après le cleanup qui décrit les
éléments visuels à placer, leurs fenêtres et leur justification. Elle est
revue avant que les éléments soient générés ou insérés.

_Avoid_: transcript enrichi, liste d’effets

**Analyse structurelle**:
La lecture du script nettoyé qui propose les sections et les éléments du plan
éditorial. Elle est la source unique des placements de titres, zooms et scènes
B-roll, mais ne rend aucun élément par elle-même.

_Avoid_: génération de scène, cleanup

**Section**:
Une portion contiguë du script nettoyé qui porte une idée ou une étape
narrative principale. Ses bornes sont ancrées dans le transcript approuvé et
peuvent recevoir plusieurs éléments du plan éditorial; l’analyse les propose,
mais la revue peut les scinder, les fusionner ou les renommer.

_Avoid_: chapitre YouTube, scène

**Élément du plan**:
Une proposition visuelle typée et localisée dans une section, comme un titre,
un zoom, une transition ou une scène B-roll. Une commande explicite prime sur
une proposition automatique concurrente au même endroit.

Chaque élément garde le même identifiant pendant la proposition, la revue, le
rendu et la composition.

_Avoid_: effet, clip

**Élément visuel**:
La réalisation approuvée d’un élément du plan éditorial. Son rendu dépend de
son type : template pour un titre, transformation de la vidéo pour un zoom,
preset pour une transition ou génération créative pour une scène B-roll.

_Avoid_: scène générique
