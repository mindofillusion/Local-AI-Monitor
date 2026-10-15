# Local AI Monitor for iCUE

Widget responsive pour le CORSAIR XENEON EDGE. Il réunit dans une même interface les métriques d’un serveur local `llama.cpp`, l’occupation réelle de la VRAM NVIDIA et les principaux capteurs matériels publiés par iCUE.

![Aperçu du widget](preview.png)

## Nouveautés de la version 2.9.0

- la VRAM affiche désormais la mémoire réellement allouée, en GiB, au lieu de convertir à tort le capteur iCUE « Frame Buffer Load » en quantité de mémoire ;
- l’ancienne carte « KV cache » est renommée **Contexte** et indique la part occupée de la fenêtre de contexte active de `llama.cpp` ;
- la mise en page du format S (840 × 344) utilise mieux la hauteur disponible ;
- le widget est non interactif afin que les gestes horizontaux commencés sur AI Console changent correctement de page dans iCUE ;
- les onglets internes sont masqués, puisque leurs boutons ne seraient plus utilisables dans ce mode. La vue Runtime reste affichée en permanence.

## Prérequis

- iCUE 5.47 ou une version ultérieure ;
- un CORSAIR XENEON EDGE ;
- un serveur `llama.cpp` accessible depuis la machine qui exécute iCUE ;
- facultatif, mais nécessaire pour une mesure exacte de la VRAM NVIDIA : un petit service local conforme au contrat décrit dans [Mesures NVIDIA fiables](#mesures-nvidia-fiables).

## Installation

1. Télécharger `Local-AI-Monitor-2.9.0.icuewidget` depuis la release **v2.9.0**.
2. Importer le fichier dans iCUE.
3. Ajouter **Local AI Monitor Responsive** au tableau de bord du XENEON EDGE.
4. Vérifier la présence du badge `v2.9.0` à côté de **AI CONSOLE**.

Le widget utilise par défaut :

- `http://127.0.0.1:18091` pour `llama.cpp` ;
- `http://127.0.0.1:4171` pour les mesures NVIDIA fiables ;
- `Qwen3-Next-80B-A3B-Instruct` comme libellé de modèle ;
- `llama.cpp` comme libellé de moteur.

Ces valeurs et les capteurs iCUE peuvent être modifiés dans les propriétés du widget.

## Routes llama.cpp attendues

Le serveur d’inférence doit exposer les routes compatibles `llama.cpp` suivantes :

- `/health` pour l’état du serveur ;
- `/metrics` pour les débits de génération et de traitement du prompt ;
- `/slots` pour l’activité, la file d’attente et l’occupation du contexte ;
- `/props` pour le nom du modèle et les propriétés du serveur.

## Mesures NVIDIA fiables

iCUE expose un pourcentage « Frame Buffer Load », mais ce pourcentage ne représente pas la quantité de VRAM allouée. La version 2.9.0 interroge donc séparément l’adresse configurée dans **Monitor URL** sur la route `/widget/metrics`.

La réponse doit être un objet JSON de cette forme :

```json
{
  "gpu": {
    "totalMiB": 24564,
    "usedMiB": 22357,
    "freeMiB": 2207,
    "utilizationPct": 7,
    "temperatureC": 40
  }
}
```

Les valeurs peuvent notamment provenir de `nvidia-smi`. Pour éviter d’exposer des informations matérielles sur le réseau, le service doit écouter uniquement sur `127.0.0.1`. Il doit aussi autoriser les requêtes CORS provenant du WebView iCUE, par exemple avec l’en-tête `Access-Control-Allow-Origin: *` sur cette route de lecture seule.

Si ce service est absent, le widget continue de fonctionner : la VRAM exacte affiche `—`, tandis que la charge et la température GPU restent obtenues auprès d’iCUE lorsque les capteurs sont disponibles.

## Formats XENEON EDGE

| Format | Dimensions | Présentation |
| --- | --- | --- |
| S | 840 × 344 | graphe, activité et quatre métriques essentielles : GPU, VRAM, contexte et température GPU |
| M | 840 × 696 | vue Runtime complète avec davantage d’espace vertical |
| L | 1688 × 696 | tableau de bord complet et typographie agrandie |
| XL | 2536 × 696 | tableau de bord complet et typographie agrandie |

## Validation locale

Le test de fumée ne dépend d’aucun paquet npm :

```powershell
node .\tests\runtime-smoke.cjs
```

Il vérifie notamment :

- le démarrage du widget ;
- la sémantique des mesures NVIDIA et du contexte ;
- le mode non interactif requis pour les gestes de changement de page ;
- la connexion unique au plugin de capteurs iCUE.

## Construction du paquet

La construction nécessite l’outil officiel `icuewidget` dans le `PATH` :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
```

Le script valide le manifeste, les traductions, les ressources, la syntaxe JavaScript et l’archive finale avant de produire le fichier `.icuewidget`.

## Retour arrière

La version 2.9.0 conserve l’identifiant iCUE `fr.pierrechevalier.localaimonitor.responsive`. Pour revenir au comportement interactif avec onglets internes, réinstaller une version antérieure depuis les releases du dépôt.
