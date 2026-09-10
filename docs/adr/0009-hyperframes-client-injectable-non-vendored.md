# 0009 — Le client HyperFrames est une interface injectable, pas un SDK vendu

## Statut

Accepté.

## Contexte

L'issue #29 demande de confier la vidéo coupée et la beat sheet remappée au
moteur externe HyperFrames pour produire le fichier vidéo final. Aucun SDK,
CLI ni endpoint HyperFrames n'existe dans ce dépôt, et la construction de
cette intégration réelle (protocole, authentification, format d'échange) est
un travail préalable non spécifié par l'issue — ADR-0007 ne tranche que la
direction du remplacement (HyperFrames à la place de DaVinci et du
scene-agent), pas le détail de l'intégration technique.

Écrire malgré tout un faux SDK complet (appel HTTP à une URL inventée, format
de fichier supposé) créerait un contrat qui n'engage à rien de réel et qui se
révélerait probablement faux le jour de la vraie intégration.

## Décision

`lib/hyperframes.ts` définit uniquement le contrat que `overlayStep`
(`steps/overlay.ts`) a besoin de consommer :

```ts
interface HyperFramesClient {
  compose(request: HyperFramesComposeRequest): Promise<HyperFramesComposeResult>
}
```

Une requête porte le chemin de `cut.mp4`, le style résolu (palette,
typographie, motion) et la liste des cartes à placer (id de carte, slots
remplis, position en secondes sur la vidéo coupée) ; une réponse porte le
chemin du fichier vidéo final. Rien de plus n'est supposé sur *comment*
HyperFrames reçoit cette requête.

`overlayStep` ne dépend que de cette interface, résolue via
`resolveHyperFramesClient()`. Par défaut, `unconfiguredHyperFramesClient`
échoue explicitement plutôt que de simuler un rendu — même posture que le
reste du pipeline face à une configuration manquante (`resolveStyle` sur une
référence inconnue, `NoMatchingCardError`) : un échec clair vaut mieux qu'un
succès inventé.

L'échange reste à sens unique (ADR-0007) : l'interface n'expose aucune
méthode pour relire un projet HyperFrames — seulement composer et récupérer
un fichier fini.

## Conséquences

- Brancher un vrai moteur HyperFrames plus tard ne touche que
  `lib/hyperframes.ts` (une implémentation concrète de `HyperFramesClient`
  plus l'appel à `registerHyperFramesClientForTest`-like wiring en
  production) — `overlayStep` et `lib/compose.ts` n'ont pas à changer.
- Tant qu'aucun client réel n'est branché, tout run qui atteint l'étape
  `overlay` échoue avec un message explicite nommant le manque — pas de
  vidéo finale produite silencieusement à moitié.
- Les tests (`tests/compose.test.ts`) exercent `buildComposeRequest` et
  `composeVideo` avec un client factice, sans dépendance à un moteur externe
  réel — même approche que `tests/cut.test.ts` pour ffmpeg.
