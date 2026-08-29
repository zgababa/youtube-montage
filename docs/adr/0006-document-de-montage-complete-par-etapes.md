# 0006 — Le document de montage se complète par étapes

Le projet conserve un document de montage persistant qui se complète par
couches simples : script nettoyé, structure, effets proposés, effets validés,
sorties générées et éléments composés dans l’export. Chaque étape enrichit ce
même document au lieu de produire une liste indépendante.

Le document reste lisible comme un plan de travail : pour chaque moment, il
indique l’effet attendu — titre, zoom ou scène —, sa raison et ce qui a été
produit. Il référence les segments du transcript et les fichiers HTML/MOV ou
FCPXML sans les recopier.

Une scène B-roll garde le même lien avec son emplacement depuis la proposition
jusqu’au rendu et à la composition. `Composé` signifie seulement que l’élément
est référencé dans le FCPXML généré; l’application ne prétend pas vérifier ce
qui a ensuite été importé ou conservé dans le NLE.
