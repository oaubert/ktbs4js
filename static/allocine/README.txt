Metadataplayer pour Allocine - README
=====================================

Dans ce dossier vous trouverez:
- un fichier polemic.htm qui contient la page qui embedde le player
- un dossier css qui contient les css et les images pour le player
- un dossier libs avec les libraries js
- le fichier concatené du code source du player (LdtPlayer-release.js)
- un fichier javascript à éditer pour définir l'interface avec votre player
  flash (LdtPlayer-allocine.js)
- un fichier json contenant des métadonnées au format Cinelab-JSON (polemic_fr.json).

Libraries js utilisées
======================

Les librairies jquery, swfobject, jwplayer et raphael sont disponibles et 
chargées automatiquement.

Changer le type du player flash lancé par le metadataplayer
===========================================================

Pour changer le type player flash instancié par le metadataplayer, il faut modifier 
la configuration du metadataplayer dans le fichier polemic.htm à la section 
"player".

Changer la source du flux rtmp
==============================

La source du flux est définie dans la configuration du metadataplayer, également à la
section "player". Il faut modifier les variables "file" et "streamer" pour pointer
vers la bonne adresse.

Problème de chargement
======================

Il est possible que la page ne semble pas se charger parce que le json de configuration ne se
charge pas. Ca peut être dû à un problème de configuration de mimetype du serveur
web.

Pour apache, il faut activer le mode mime_module et ensuite rajouter :

<IfModule mime_module>
  AddType application/json .json
</IfModule>