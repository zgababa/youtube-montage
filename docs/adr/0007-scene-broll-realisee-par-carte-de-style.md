# 0007 — Une scène B-roll est réalisée par carte de style, pas par génération créative

## Statut

Accepté. Amende
[`0005 — Le plan éditorial est revu avant génération`](0005-plan-editorial-revu-avant-generation.md)
sur un point précis : la phrase « génération créative uniquement pour les
scènes B-roll » ne décrit plus le rendu des scènes B-roll. Le reste de 0005 —
la revue du plan avant génération, la primauté des commandes explicites,
l'ancrage des bornes sur les segments approuvés — est inchangé.

## Contexte

0005 rangeait les éléments visuels en deux familles : déterministe pour les
titres, zooms et transitions, créative pour les scènes B-roll. Concrètement,
une scène B-roll était un fichier HTML libre écrit par un LLM (`sceneAgent`),
vérifié par un validateur, réparé jusqu'à trois fois, puis rendu image par
image par Chromium.

Trois choses ont mal vieilli dans ce choix :

- **La cohérence est le sujet.** Douze agents partageant le même brief
  produisent douze scènes individuellement raisonnables qui ne se ressemblent
  pas. La charte (`project.styleGuide`) a été ajoutée pour compenser, sans
  supprimer la cause : le modèle réinvente une mise en page à chaque scène.
- **Le coût du non-déterminisme.** Une réparation en trois tentatives, un
  validateur qui rejette, un modèle nommé par scène : beaucoup de machinerie
  pour un résultat qu'on ne peut ni rejouer ni diff.
- **La dépendance à Chromium.** Le rendu headless est la partie la plus lente
  et la plus fragile du pipeline, pour un résultat qui reste une capture.

## Décision

Pour les scènes B-roll, la réalisation devient une traduction déterministe :

1. Le `Style` de la chaîne est résolu depuis un `styleRef` porté par le projet.
2. Une carte de style est choisie automatiquement, son `purpose` devant
   correspondre au type de l'élément du plan.
3. Le texte de la scène remplit les slots déclarés par la carte.
4. Le résultat est persisté comme une entrée de `Beat sheet` : carte choisie,
   texte de chaque slot, minutage d'entrée repris de l'élément du plan.

La créativité se déplace : elle est dans le jeu de cartes du `Style`, décidé
une fois pour la chaîne, et non dans une invention par scène. La régénération
depuis la revue emprunte le même chemin, au même seam.

Aucun appel LLM et aucun appel Chromium n'est nécessaire pour produire une
entrée de beat sheet. Les champs propres à l'ancien mécanisme — chemin HTML,
chemin d'export, durée mesurée, modèle utilisé — ne sont plus produits pour
une scène passée par ce chemin.

Quand aucune carte ne correspond, ou qu'un texte dépasse la contrainte d'un
slot, la scène échoue explicitement avec la raison, dans la même posture que
l'ADR 0003 : jamais une carte forcée, jamais une troncature silencieuse.

## Conséquences

- Deux scènes du même type dans la même chaîne se ressemblent par
  construction, sans charte à faire respecter par un prompt.
- Une scène est rejouable et lisible en diff : la même entrée de plan et le
  même `Style` donnent la même entrée de beat sheet.
- Le rendu d'une entrée de beat sheet vers une vidéo n'est pas couvert ici.
  Tant qu'il ne l'est pas, le pipeline s'arrête après le beat sheet et ne
  produit pas de ProRes pour ces scènes.
- `sceneAgent`, `lib/validate-scene.ts` et `lib/render.ts` restent en place
  mais ne sont plus appelés sur ce chemin. Leur suppression, ainsi que le
  remplacement de `project.styleGuide` par le `Style` nommé dans l'UI et les
  routes API, sont des chantiers séparés.
- Les titres, zooms et transitions ne sont pas concernés : ils étaient déjà
  déterministes dans 0005 et le restent.
