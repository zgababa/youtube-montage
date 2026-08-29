# La timeline et le composite ne sont plus des portes du pipeline

Supersede ADR 0008. Écrire `timeline.fcpxml` et y composer les scènes/titres
exportés sont des opérations déterministes et bon marché — aucun appel IA, pas
de rendu — donc les faire attendre une approbation humaine dans le workflow
n'avait pas de justification, seulement du coût : une porte à laquelle un run
peut rester bloqué (par ex. si un cleanup est réapprouvé après coup, rendant
`timelineApprovedAt` périmé sans que rien ne le redétecte), et un bouton dont
le sens dépend d'un état à deviner côté client. Les deux étapes s'exécutent
maintenant automatiquement dans le workflow sans jamais suspendre, et un
bouton unique, toujours disponible et indépendant d'un run en cours
(`app/api/projects/[id]/timeline/route.ts`), réexporte et recompose à chaque
clic à partir de l'état courant de `project.json`.
