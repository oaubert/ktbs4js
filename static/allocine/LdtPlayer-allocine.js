/* changer ce fichier pour étendre le player */

/* Il faut étendre cette classe pour que le metadataplayer supporte le player
   allocine. Pour l'instant, le code présent est celui pour le jwplayer
 */
IriSP.PopcornReplacement.allocine = function(container, options) {
  /**
   * Ce constructeur reçoit deux paramètres :
   * - container est une chaine de caractère indiquant l'id du div dans lequel il
   *   doit s'initialiser
   * - options est un dictionnaire contenant les options de configuration du player
   *   (correspond à la partie de configuration du player dans polemic.htm)
   */
  
  /**
     appel du parent pour initialiser les structures communes à tous les players -
     obligatoire.
  */
  IriSP.PopcornReplacement.player.call(this, container, options);

  this.media.duration = options.duration; /* optionnel */
  
  /* Préservation de this, au cas où */
  var _this = this;
  
  /** Déclaration au player des fonctions que l'api flash expose - brièvement:
   *  - play et pause ne prennent pas de paramètres
   *  - lorsque le metadataplayer appelle getPosition, le player flash doit retourner
   *    la durée depuis le début en secondes,
   *  - seek reçoit en paramètre la position en secondes depuis le début de la 
   *    vidéo vers laquelle on veut seeker.
   *  - getMute retourne true si le player est muté et false sinon
   *  - setMute prend un paramètre. Si celui-ci est true la vidéo doit etre mutée,
   *    sinon le son doit être activé.
   *
   *  NB: les valeurs de retour ne sont utilisés quand pour getPosition et getMute.
   */
  this.playerFns = {
    play: function() { return jwplayer(this.container).play(); },
    pause: function() { return jwplayer(this.container).pause(); },
    getPosition: function() { return jwplayer(this.container).getPosition(); },
    seek: function(pos) { return jwplayer(this.container).seek(pos); },
    getMute: function() { return jwplayer(this.container).getMute() },
    setMute: function(p) { return jwplayer(this.container).setMute(p); }
  }

  /*  Déclaration des callbacks au jwplayer - ces callbacks sont appelés par le 
   *  player flash au moment où les évenements correspondants sont declenchés.
   *  le dictionnaire this.callbacks
   *  contient cinq entrées : onReady, onTime, onPlay, onPause, onSeek.
   *  
   *  - onReady est une fonction qui ne prend pas de paramètres et qui est appellée
   *     quand le player flash a fini de s'initialiser.
   *  - onTime est appelée périodiquement (par ex, toutes les demi-secondes). Elle
   *    reçoit en paramètre un dictionnaire qui doit contenir un champ nommé position
   *    qui contient le temps écoulé depuis le début de la vidéo.
   *  - onPlay est appelé quand le player commence ou reprend la lecture. Le callback
   *    ne prend pas de paramètres.
   *  - onPause est appellé quand le player entre en état pausé. Le callback ne prend
   *    pas de paramètres.
   *  - onSeek est appelé quand le player flash seeke une vidéo. Il reçoit en 
   *    paramètre un object contenant deux entrées :
   *       - position: la position en secondes depuis le début de la vidéo au moment où l'on seeke
   *       - offset: la position cible en secondes depuis le début de la vidéo.
   *    
   *  Pour réference, voici la doc des évenements proposés par le jwplayer :     
   *  http://www.longtailvideo.com/support/jw-player/jw-player-for-flash-v5/12540/javascript-api-reference#Events
   */
  options.events = this.callbacks;

  /* initialisation du player dans le div qui possède l'id this.container -
     a remplacer par un appel à swfobject par exemple */
  jwplayer(this.container).setup(options);
};

/* Obligatoire pour l'héritage - ne pas modifier */
IriSP.PopcornReplacement.allocine.prototype = new IriSP.PopcornReplacement.player("", {});