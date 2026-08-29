# Plan : Effets sonores (SFX) et transitions graphiques étendues

## Contexte

La PR récente (`feat: animated zooms, dynamic titles, lower-thirds, and transitions`) a ajouté 3 types de transitions (crossfade, zoom-punch, dip-to-black), des zooms, titres et lower-thirds. Ce plan ajoute :

1. **Des effets sonores** (SFX) embarqués, placés automatiquement dans la timeline FCPXML
2. **Des transitions graphiques étendues** : wipes directionnels et pushes/slides, en FCPXML natif

---

## Partie 1 : Transitions étendues

### 1.1 Nouveaux types de transitions

Ajouter au `TransitionTypeSchema` dans `src/mastra/schemas.ts` :

```
"wipe-left", "wipe-right", "wipe-top", "wipe-bottom",
"wipe-diagonal", "push-left", "push-right", "push-top", "push-bottom"
```

### 1.2 FCPXML natif — mapping effets

Dans `src/mastra/lib/fcpxml.ts`, ajouter les UIDs et paramètres :

| Type | FCPXML effect UID | Paramètres |
|------|-------------------|------------|
| `wipe-left` | `FxPlug:F5B2B6B4-0B2F-4B5A-9E8A-3A5B8C7D2E1F` (Wipe) | angle=90 |
| `wipe-right` | même UID | angle=270 |
| `wipe-top` | même UID | angle=0 |
| `wipe-bottom` | même UID | angle=180 |
| `wipe-diagonal` | même UID | angle=315 (ou 135) |
| `push-left` | `FxPlug:A1B2C3D4-E5F6-7890-ABCD-EF1234567890` (Push) | direction=left |
| `push-right` | même UID | direction=right |
| `push-top` | même UID | direction=top |
| `push-bottom` | même UID | direction=bottom |

> **Note** : Les UIDs ci-dessus sont des placeholders. Les vrais UIDs doivent être extraits d'un export FCPXML DaVinci Resolve avec ces transitions appliquées. L'implémentation utilisera des `<param>` enfants pour les angles/directions. Si l'UID n'est pas trouvé, fallback vers Cross Dissolve (comme zoom-punch aujourd'hui).

### 1.3 Fichiers à modifier

| Fichier | Changement |
|---------|-----------|
| `src/mastra/schemas.ts` | Étendre `TransitionTypeSchema` avec les 9 nouveaux types |
| `src/mastra/lib/fcpxml.ts` | Ajouter les UIDs dans `TRANSITION_EFFECT_UIDS`, étendre `transitionXml()` pour générer les `<param>` d'angle/direction |
| `src/mastra/lib/editing-plan.ts` | Étendre `EditingPlanDecisionSchema.transitionType` avec les nouveaux types |
| `src/mastra/agents/structural-agent.ts` | Mettre à jour le prompt pour proposer les nouveaux types |
| `tests/fcpxml.test.ts` | Tests pour les nouvelles transitions (XML généré, paramètres) |

### 1.4 Implémentation `transitionXml()`

La fonction `transitionXml()` actuelle génère un `<transition>` simple. Pour les wipes et pushes, il faudra générer :

```xml
<transition name="Wipe" duration="15/30s">
  <effect name="Wipe" uid="FxPlug:..."/>
  <param name="angle" value="315"/>
</transition>
```

La logique :
- `crossfade`, `dip-to-black` : inchangé (déjà fonctionnel)
- `zoom-punch` : inchangé (fallback Cross Dissolve)
- `wipe-*` : un seul UID, paramètre `angle` qui varie
- `push-*` : un seul UID, paramètre `direction` qui varie

### 1.5 Noms d'affichage

| Type | Nom FCPXML |
|------|-----------|
| `wipe-left` | "Wipe Left" |
| `wipe-right` | "Wipe Right" |
| `wipe-top` | "Wipe Up" |
| `wipe-bottom` | "Wipe Down" |
| `wipe-diagonal` | "Diagonal Wipe" |
| `push-left` | "Push Left" |
| `push-right` | "Push Right" |
| `push-top` | "Push Up" |
| `push-bottom` | "Push Down" |

---

## Partie 2 : Effets sonores (SFX)

### 2.1 Architecture

Les SFX sont des clips audio-only placés dans la timeline FCPXML comme des connected clips sur une lane audio négative (ex: `lane="-1"`). Ils accompagnent des éléments visuels existants (transitions, zooms, entrées de scène).

### 2.2 Bibliothèque embarquée

Dossier : `src/mastra/public/sfx/`

Fichiers à créer/trouver (royalty-free, < 2s chacun) :

| Fichier | Usage | Durée cible |
|---------|-------|-------------|
| `whoosh.mp3` | Zoom effects | ~0.5s |
| `transition.mp3` | Entre sections (transitions) | ~0.8s |
| `pop.mp3` | Entrée de scène B-roll | ~0.3s |
| `swoosh.mp3` | Wipe transitions | ~0.6s |
| `thud.mp3` | Dip-to-black | ~0.4s |

> **Action requise** : Trouver/générer des SFX royalty-free. Options : freesound.org, sonniss.com GDC bundles, ou générer avec un outil audio.

### 2.3 Schema

Dans `src/mastra/schemas.ts`, ajouter :

```typescript
export const SfxTypeSchema = z.enum([
  "whoosh",      // zoom
  "transition",  // section transition
  "pop",         // scene entrance
  "swoosh",      // wipe
  "thud",        // dip-to-black
])
```

Sur `EditingPlanElementSchema`, ajouter un champ optionnel :

```typescript
sfxType: SfxTypeSchema.optional(),
```

### 2.4 FCPXML — audio assets

Dans `src/mastra/lib/fcpxml.ts` :

- Nouveau type `SfxClip` :
  ```typescript
  interface SfxClip {
    sfxType: string
    runIndex: number
    runOffset: number
    durationSec: number
  }
  ```

- `<asset>` pour chaque SFX utilisé :
  ```xml
  <asset id="sfx-whoosh" name="Whoosh"
    hasAudio="1" hasVideo="0"
    format="format-1" duration="30/30s" start="0s">
    <media-rep kind="original-media" src="file:///path/to/sfx/whoosh.mp3"/>
  </asset>
  ```

- `<asset-clip>` sur lane audio négative :
  ```xml
  <asset-clip name="Whoosh" ref="sfx-whoosh" lane="-1"
    offset="150/30s" start="0s" duration="15/30s"/>
  ```

### 2.5 Placement automatique

Dans `src/mastra/steps/overlay.ts`, le placement des SFX suit les éléments approuvés :

| Élément | SFX automatique |
|---------|----------------|
| `transition` approuvé | `swoosh` (wipe) ou `transition` (autres) |
| `zoom` approuvé | `whoosh` |
| `scene` approuvé (entrée) | `pop` |
| `dip-to-black` | `thud` |

Le structural agent peut aussi proposer un `sfxType` explicite sur un élément, qui override le mapping automatique.

### 2.6 Fichiers à modifier

| Fichier | Changement |
|---------|-----------|
| `src/mastra/schemas.ts` | `SfxTypeSchema`, champ `sfxType` sur `EditingPlanElementSchema` |
| `src/mastra/lib/fcpxml.ts` | `SfxClip` interface, `sfxAssetXml()`, placement dans `buildFcpxml()` |
| `src/mastra/steps/overlay.ts` | Logique de mapping élément → SFX, passage à `buildFcpxml()` |
| `src/mastra/lib/editing-plan.ts` | `sfxType` dans `EditingPlanDecisionSchema` |
| `src/mastra/agents/structural-agent.ts` | Prompt update pour proposer des SFX |
| `src/mastra/lib/paths.ts` | Helper `sfxPath()` pour résoudre les fichiers SFX |
| `tests/fcpxml.test.ts` | Tests pour les assets audio et connected clips SFX |

---

## Partie 3 : Mise à jour du structural agent

Le prompt dans `src/mastra/agents/structural-agent.ts` doit être étendu pour :

1. Proposer les nouveaux types de transitions (wipe-*, push-*)
2. Optionnellement proposer un `sfxType` sur les éléments (zoom, transition, scene)
3. Expliquer quand utiliser chaque type de transition :
   - `wipe-diagonal` : transition dynamique entre sections
   - `push-*` : mouvement directionnel qui guide l'œil
   - `dip-to-black` : pause dramatique
   - `crossfade` : transition douce par défaut

---

## Ordre d'implémentation

1. **Transitions** (indépendant des SFX) :
   - `schemas.ts` — étendre `TransitionTypeSchema`
   - `fcpxml.ts` — UIDs + `transitionXml()` avec paramètres
   - `editing-plan.ts` — decision schema
   - `structural-agent.ts` — prompt
   - `tests/fcpxml.test.ts` — tests

2. **SFX** (dépend des transitions pour le mapping swoosh/thud) :
   - `schemas.ts` — `SfxTypeSchema` + champ
   - `paths.ts` — helper SFX
   - `fcpxml.ts` — audio assets + connected clips
   - `overlay.ts` — mapping automatique
   - `editing-plan.ts` — decision schema
   - `structural-agent.ts` — prompt
   - `tests/fcpxml.test.ts` — tests
   - SFX files dans `src/mastra/public/sfx/`

---

## Validation

1. `bun test` — tous les tests existants + nouveaux passent
2. `bun run typecheck` — pas d'erreurs de type
3. `bun run lint` — pas de violations
4. Vérifier manuellement que le FCPXML généré avec des transitions wipe est importable dans DaVinci Resolve
5. Vérifier que les SFX apparaissent comme des clips audio sur une lane séparée dans le NLE

---

## Risques et mitigations

| Risque | Mitigation |
|--------|-----------|
| UIDs de transitions wipe/push inconnus | Extraire d'un vrai export DaVinci Resolve, fallback vers Cross Dissolve |
| Fichiers SFX non trouvés au runtime | Vérifier l'existence au démarrage du pipeline, loguer un warning |
| Lane audio négative non supportée par Resolve | Tester avec Resolve 19+, documenter la compatibilité |
| SFX trop longs ou mal synchronisés | Bornes de durée (< 1s), snapping au frame grid |
