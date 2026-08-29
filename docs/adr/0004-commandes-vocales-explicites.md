# 0004 — Les marqueurs vocaux sont des commandes de montage explicites

> **Obsolète, remplacée par [0007](0007-titres-declares-dans-le-script-original.md).**
> Le cleanup ignore la convention `TITRE ... TITRE` et peut couper la commande
> comme un filler avant même qu'elle atteigne le parsing — en pratique le
> mécanisme n'est pas fiable. Les nouveaux projets déclarent leurs titres dans
> le script original plutôt qu'à voix haute.

Le créateur peut prononcer une commande encadrée par un marqueur réservé, par
exemple `TITRE Les agents TITRE`, pour demander une opération éditoriale. Le
marqueur d’ouverture et celui de fermeture sont retirés du montage final; les
mots entre les deux forment le corps de commande et délimitent précisément la
demande. Les mots ordinaires comme « titre » ne déclenchent rien par eux-mêmes :
cette syntaxe explicite évite les faux positifs et rend le comportement
prévisible.

Le catalogue de types est explicite et fermé à l’échelle d’une version : une
commande inconnue est signalée comme telle au lieu d’être interprétée par l’IA
comme un nouvel effet. Cette contrainte permet de tester séparément le parsing,
le placement et le rendu de chaque commande.
