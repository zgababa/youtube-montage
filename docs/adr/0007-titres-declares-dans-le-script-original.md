# 0007 — Les titres se déclarent dans le script original, pas à voix haute

Remplace [0004](0004-commandes-vocales-explicites.md). La commande vocale
`TITRE ... TITRE` dépendait d’un maillon qui ne la connaissait pas : le
cleanup n’a aucune notion de ce marqueur et peut le classer comme filler
(« titre sans contenu parlé ») et le couper avant que le parsing des
commandes n’ait la moindre chance de le voir. Le mécanisme n’est donc pas
fiable en pratique, et le corriger demanderait d’apprendre la convention au
cleanup agent en plus du parsing — pour un gain marginal, puisque le
créateur connaît déjà ses titres avant d’enregistrer.

Le projet garde maintenant un champ `sourceScript` optionnel : le script ou
plan original du créateur, écrit avant l’enregistrement. Ce n’est jamais le
transcript, et ce n’est jamais traité comme tel — ce qui est réellement dit
peut le paraphraser librement. C’est un contexte en lecture seule pour
l’analyse structurelle : le même marqueur `TITRE ... TITRE`, écrit cette
fois plutôt que parlé, y indique une intention de titre déclarée par le
créateur. L’agent l’utilise pour reconnaître le bon moment dans le script
réellement approuvé, mais n’a aucune autorité pour inventer un segment —
chaque section et élément qu’il retourne doit toujours s’ancrer sur un
Segment réel du script approuvé.

Les annotations manuelles `TITRE` ajoutées depuis l’interface (issue #7,
`TitleAnnotationSchema`) ne sont pas concernées : elles ciblent directement
un segment du script approuvé et n’ont jamais dépendu de la parole. Seule la
commande vocale explicite disparaît.
