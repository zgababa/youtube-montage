# 0005 — Le plan éditorial est revu avant génération

Après l’approbation du cleanup, une analyse structurelle peut proposer des
titres, zooms et scènes. Cette analyse produit un plan éditorial
explicable — élément, fenêtre temporelle, raison et confiance — qui passe par
une revue humaine avant toute génération ou insertion dans la timeline.

Le plan est organisé en sections du script, et les commandes explicites
prononcées par le créateur priment sur les propositions automatiques
concurrentes; elles ne doivent pas être dupliquées.

Les sections elles-mêmes restent des propositions révisables : leurs bornes et
leur nom peuvent être scindés, fusionnés ou modifiés avant la validation des
éléments visuels.

Les bornes du plan référencent les segments approuvés du transcript; elles ne
sont pas des secondes produites par le modèle. Les éléments approuvés sont
ensuite rendus par type : templates et transformations déterministes pour les
effets éditoriaux, génération créative uniquement pour les scènes B-roll.

Les commandes vocales et les annotations manuelles sont deux entrées vers la
même intention de montage structurée. Une annotation est attachée à une
sélection de segments sans réécrire le transcript, ce qui permet notamment de
corriger une commande vocale mal reconnue.

Les annotations manuelles ciblent uniquement le script approuvé; elles ne
restaurent pas une coupe du cleanup. La restauration d’un span coupé reste une
décision séparée.

L’analyse structurelle devient la source unique des placements, y compris pour
le B-roll. Le générateur de scènes existant reste responsable du rendu des
scènes acceptées, mais le step de décision séparé ne propose plus un second
placement concurrent.

La première version cible les titres, les zooms et les scènes B-roll. Les
titres automatiques visent les sections majeures; les zooms sont réservés aux
moments saillants, avec des limites de densité plutôt qu’une répétition à
chaque changement d’idée.

Cette frontière conserve la vitesse de l’automatisation sans transformer une
interprétation stylistique de l’IA en montage irréversible ou coûteux.
