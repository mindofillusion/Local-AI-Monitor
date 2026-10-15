# Historique des versions

## 2.9.0

- rend le widget non interactif afin que les gestes horizontaux soient pris en charge par iCUE ;
- masque la barre d’onglets devenue non utilisable dans ce mode ;
- conserve la vue Runtime comme tableau de bord principal ;
- ajoute un test garantissant la configuration requise pour les gestes.

## 2.8.0

- remplace la conversion incorrecte du capteur iCUE « Frame Buffer Load » par des mesures NVIDIA fiables obtenues auprès d’un service local en lecture seule ;
- affiche la VRAM utilisée, totale et libre en GiB ;
- renomme « KV cache » en « Contexte » et mesure l’occupation de la fenêtre de contexte active ;
- conserve les capteurs iCUE comme solution de repli pour la charge et la température GPU.

## 2.7.0

- améliore l’utilisation de la hauteur et la lisibilité du format S 840 × 344 ;
- agrandit les valeurs principales sans retirer le graphe ni les métriques essentielles.

## 2.6.0

- augmente la lisibilité des formats S et M ;
- conserve toutes les métriques en M avec une grille sur deux lignes ;
- concentre la vue Runtime du format S sur GPU, VRAM, cache KV et température GPU ;
- maintient CPU, RAM et erreurs dans les onglets dédiés en S ;
- conserve la correction de stabilité supprimant les filtres de flou GPU ;
- affiche le numéro de version dans le bandeau du widget ;
- améliore la découverte et la sélection des capteurs matériels iCUE.
