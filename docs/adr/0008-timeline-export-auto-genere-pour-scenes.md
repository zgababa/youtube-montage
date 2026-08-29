---
status: superseded by ADR 0009
---

# L'export timeline se génère automatiquement pour débloquer Scenes

Jusqu'ici, l'étape Scenes restait verrouillée tant que l'export timeline
n'avait pas été approuvé manuellement (réglage du silence cap compris) — un
créateur pressé de voir ses scènes devait d'abord naviguer vers une étape
qui ne l'intéressait pas. On génère désormais l'export timeline avec un
silence cap par défaut dès que Scenes en a besoin, sans attendre
d'approbation humaine, pour ne plus bloquer sur une porte dont la valeur
n'a d'intérêt que si on veut l'affiner. Le réglage reste modifiable après
coup depuis le même bouton, qui régénère alors ce qui en dépend.
