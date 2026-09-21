/* ============================================================
 * 3D 场景：采场/排土场台阶式地形 + 监测点 + 雷达扫描
 * 依赖: THREE r128 (全局), MineData
 * ============================================================ */
(function (global) {
  'use strict';

  var D = global.MineData;
  var scene, camera, renderer, controls;
  var markerGroups = {};      // id -> {group, head, ring, sprite, canvas, ctx, texture, hit}
  var hitMeshes = [];
  var radarBeams = [];
  var raycaster, pointer;
  var camTween = null;
  var selectedId = null;
  var clockT = 0;
  var containerEl = null;

  var VIEW = {
    all:  { pos: [190, 360, 640], tgt: [-30, -20, 20] },
    pit:  { pos: [40, 230, 330],  tgt: [-140, -50, -60] },
    dump: { pos: [450, 220, 470], tgt: [230, 25, 150] }
  };

  /* ---------------- 初始化 ---------------- */
  function init(container) {
    containerEl = container;
    var w = container.clientWidth, h = container.clientHeight;

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);
    scene.fog = new THREE.Fog(0x0b1220, 750, 1700);

    camera = new THREE.PerspectiveCamera(55, w / h, 1, 4000);
    camera.position.set.apply(camera.position, VIEW.all.pos);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set.apply(controls.target, VIEW.all.tgt);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = 1.45;
    controls.minDistance = 100;
    controls.maxDistance = 1500;

    // 灯光
    scene.add(new THREE.HemisphereLight(0x8fb6ff, 0x2a2118, 0.6));
    var sun = new THREE.DirectionalLight(0xfff2e0, 1.05);
    sun.position.set(320, 520, 220);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -520; sun.shadow.camera.right = 520;
    sun.shadow.camera.top = 520; sun.shadow.camera.bottom = -520;
    sun.shadow.camera.near = 50; sun.shadow.camera.far = 1600;
    sun.shadow.bias = -0.0006;
    scene.add(sun);

    buildTerrain();
    buildPond();
    buildMarkers();
    buildRadarStation(-140, 220, 'pit');   // 采场雷达（南岸）
    buildRadarStation(430, 60, 'dump');    // 排土场雷达

    // 远景底板（低于坑底，避免遮挡采场台阶）
    var floor = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshBasicMaterial({ color: 0x0d1420 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -170;
    scene.add(floor);

    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();
    bindClick();

    window.addEventListener('resize', onResize);
    animate();
  }

  /* ---------------- 地形 ---------------- */
  function buildTerrain() {
    var SIZE = 1100, SEG = 170;
    var geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    var pos = geo.attributes.position;
    var colors = new Float32Array(pos.count * 3);
    var c = new THREE.Color();
    var pit = D.CONFIG.pit, dump = D.CONFIG.dump;

    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), z = pos.getZ(i);
      var y = D.terrainHeight(x, z);
      pos.setY(i, y);

      var dp = Math.hypot(x - pit.cx, z - pit.cz);
      var dd = Math.hypot(x - dump.cx, z - dump.cz);
      var jitter = (Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1 * 0.025;

      if (dp < pit.radius) {
        // 采场：灰褐岩层，随深度变暗，台阶分层
        var lvl = Math.floor((pit.radius - dp) / pit.benchW);
        var depthK = Math.min(lvl * pit.benchH / pit.maxDepth, 1);
        c.setHSL(0.08, 0.16, 0.34 - depthK * 0.13 + (lvl % 2) * 0.022 + jitter);
      } else if (dd < dump.radius) {
        // 排土场：土黄堆体
        var ld = Math.floor((dump.radius - dd) / dump.benchW);
        c.setHSL(0.1, 0.28, 0.3 + Math.min(ld, 6) * 0.012 + (ld % 2) * 0.02 + jitter);
      } else {
        // 地表：灰绿
        c.setHSL(0.3, 0.1, 0.26 + jitter);
      }
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    var mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.02 });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    scene.add(mesh);
  }

  function buildPond() {
    var pit = D.CONFIG.pit;
    var pond = new THREE.Mesh(
      new THREE.CircleGeometry(16, 40),
      new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.85 })
    );
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(pit.cx, -pit.maxDepth + 12.5, pit.cz);
    scene.add(pond);
  }

  /* ---------------- 监测点标记 ---------------- */
  function buildMarkers() {
    D.POINTS.forEach(function (p) {
      var g = new THREE.Group();
      g.position.set(p.x, p.y, p.z);

      // 立杆
      var pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.45, 4.2, 8),
        new THREE.MeshStandardMaterial({ color: 0x9aa5b1, roughness: 0.6 })
      );
      pole.position.y = 2.1;
      pole.castShadow = true;
      g.add(pole);

      // 头部：GNSS 球形 / 雷达 菱形
      var headGeo = p.type === '雷达'
        ? new THREE.OctahedronGeometry(2.2)
        : new THREE.SphereGeometry(1.9, 20, 16);
      var head = new THREE.Mesh(headGeo,
        new THREE.MeshStandardMaterial({ color: p.cur.status.color, emissive: p.cur.status.color, emissiveIntensity: 0.45, roughness: 0.35 }));
      head.position.y = 5.4;
      head.castShadow = true;
      head.userData.pointId = p.id;
      g.add(head);

      // 隐形大点击热区
      var hit = new THREE.Mesh(new THREE.SphereGeometry(6, 8, 6),
        new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = 5.4;
      hit.userData.pointId = p.id;
      g.add(hit);
      hitMeshes.push(hit, head);

      // 告警脉冲环
      var ring = new THREE.Mesh(
        new THREE.RingGeometry(2.6, 3.4, 32),
        new THREE.MeshBasicMaterial({ color: p.cur.status.color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.4;
      g.add(ring);

      // 选中框
      var sel = new THREE.Mesh(
        new THREE.SphereGeometry(3.4, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.9 })
      );
      sel.position.y = 5.4;
      sel.visible = false;
      g.add(sel);

      // 标签（按台阶错开高度，减少重叠）
      var label = makeLabel(p);
      label.sprite.position.y = 11.5 + (p.lvl % 3) * 2.2;
      g.add(label.sprite);

      scene.add(g);
      markerGroups[p.id] = { group: g, head: head, ring: ring, sel: sel, label: label };
    });
  }

  function makeLabel(p) {
    var canvas = document.createElement('canvas');
    canvas.width = 300; canvas.height = 76;
    var texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    var sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture, depthTest: false, transparent: true, opacity: 0.95
    }));
    sprite.scale.set(30, 7.6, 1);
    sprite.renderOrder = 999;
    var label = { sprite: sprite, canvas: canvas, texture: texture };
    drawLabel(label, p);
    return label;
  }

  function drawLabel(label, p) {
    var ctx = label.canvas.getContext('2d');
    ctx.clearRect(0, 0, 300, 76);
    ctx.fillStyle = 'rgba(8,14,26,0.78)';
    roundRect(ctx, 2, 2, 296, 72, 12);
    ctx.fill();
    ctx.strokeStyle = p.cur.status.color;
    ctx.lineWidth = 3;
    roundRect(ctx, 2, 2, 296, 72, 12);
    ctx.stroke();
    ctx.fillStyle = p.cur.status.color;
    ctx.beginPath();
    ctx.arc(30, 38, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f1f5f9';
    ctx.font = 'bold 27px "Microsoft YaHei", sans-serif';
    ctx.fillText(p.id + '  ' + p.cur.rate.toFixed(1) + 'mm/d', 54, 27);
    ctx.fillStyle = '#9fb2c8';
    ctx.font = '22px "Microsoft YaHei", sans-serif';
    ctx.fillText('位移 ' + p.cur.tot.toFixed(0) + 'mm', 54, 57);
    label.texture.needsUpdate = true;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------------- 雷达站 ---------------- */
  function buildRadarStation(x, z, target) {
    var y = D.terrainHeight(x, z);
    var g = new THREE.Group();
    g.position.set(x, y, z);

    // 目标方位（rotation.y: 局部+X -> (cosθ, -sinθ)）
    var tgt = target === 'pit'
      ? { x: D.CONFIG.pit.cx, z: D.CONFIG.pit.cz }
      : { x: D.CONFIG.dump.cx, z: D.CONFIG.dump.cz };
    var baseAim = -Math.atan2(tgt.z - z, tgt.x - x);

    // 基座 + 设备舱
    var base = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3, 2.4, 10),
      new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7 }));
    base.position.y = 1.2; base.castShadow = true;
    g.add(base);
    var cabin = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 2.6),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.5, metalness: 0.3 }));
    cabin.position.y = 3.5; cabin.castShadow = true;
    g.add(cabin);

    // 天线喇叭（朝向目标）
    var yaw = new THREE.Group();
    yaw.position.y = 5.6;
    yaw.rotation.y = baseAim;
    var horn = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.6, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0e7490, roughness: 0.4 }));
    horn.rotation.z = -Math.PI / 2;   // 锥尖朝后，喇叭口朝 +X（目标方向）
    yaw.add(horn);
    g.add(yaw);

    // 扫描扇面（水平扇形 + 前沿线，向下微倾覆盖坡面）
    var shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.absarc(0, 0, 330, -Math.PI / 9, Math.PI / 9, false);
    shape.lineTo(0, 0);
    var sectorGeo = new THREE.ShapeGeometry(shape, 24);
    sectorGeo.rotateX(-Math.PI / 2);
    var sector = new THREE.Mesh(sectorGeo, new THREE.MeshBasicMaterial({
      color: 0x22d3ee, transparent: true, opacity: 0.13,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending
    }));
    var edge = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0), new THREE.Vector3(330, 0, 0)
      ]),
      new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.8, fog: false })
    );
    var tilt = new THREE.Group();
    tilt.rotation.z = -0.12;   // 向下倾斜覆盖坡面
    tilt.add(sector);
    tilt.add(edge);

    var beamPivot = new THREE.Group();
    beamPivot.position.y = 6.5;
    beamPivot.add(tilt);
    g.add(beamPivot);

    scene.add(g);
    radarBeams.push({ pivot: beamPivot, baseAim: baseAim, phase: Math.random() * Math.PI * 2 });

    // 雷达标签
    var c = document.createElement('canvas');
    c.width = 260; c.height = 60;
    var ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(8,20,30,0.75)';
    roundRect(ctx, 2, 2, 256, 56, 10); ctx.fill();
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2.5;
    roundRect(ctx, 2, 2, 256, 56, 10); ctx.stroke();
    ctx.fillStyle = '#67e8f9';
    ctx.font = 'bold 26px "Microsoft YaHei", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('边坡雷达 ' + (target === 'pit' ? '①' : '②'), 20, 32);
    var tex = new THREE.CanvasTexture(c);
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(30, 7, 1);
    sp.position.set(x, y + 14, z);
    sp.renderOrder = 999;
    scene.add(sp);
  }

  /* ---------------- 点击拾取 ---------------- */
  function bindClick() {
    var downX = 0, downY = 0;
    renderer.domElement.addEventListener('pointerdown', function (e) {
      downX = e.clientX; downY = e.clientY;
    });
    renderer.domElement.addEventListener('click', function (e) {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return; // 拖拽不算点击
      var rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      var hits = raycaster.intersectObjects(hitMeshes, false);
      if (hits.length && Scene3D.onPointClick) {
        Scene3D.onPointClick(hits[0].object.userData.pointId);
      }
    });
  }

  /* ---------------- 相机飞行 ---------------- */
  function flyTo(view) {
    var v = VIEW[view] || VIEW.all;
    camTween = {
      p0: camera.position.clone(), p1: new THREE.Vector3().fromArray(v.pos),
      t0: controls.target.clone(), t1: new THREE.Vector3().fromArray(v.tgt),
      start: performance.now(), dur: 1100
    };
  }

  function focusPoint(id) {
    var p = D.getPoint(id);
    if (!p) return;
    camTween = {
      p0: camera.position.clone(),
      p1: new THREE.Vector3(p.x + 90, p.y + 110, p.z + 150),
      t0: controls.target.clone(),
      t1: new THREE.Vector3(p.x, p.y, p.z),
      start: performance.now(), dur: 1100
    };
  }

  /* ---------------- 动画循环 ---------------- */
  function animate() {
    requestAnimationFrame(animate);
    var dt = 0.016;
    clockT += dt;

    if (camTween) {
      var k = Math.min((performance.now() - camTween.start) / camTween.dur, 1);
      var e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      camera.position.lerpVectors(camTween.p0, camTween.p1, e);
      controls.target.lerpVectors(camTween.t0, camTween.t1, e);
      if (k >= 1) camTween = null;
    }

    // 告警脉冲
    D.POINTS.forEach(function (p) {
      var m = markerGroups[p.id];
      if (!m) return;
      var lv = p.cur.status.key;
      if (lv === 'alert' || lv === 'alarm') {
        var s = 1 + 0.35 * Math.sin(clockT * (lv === 'alarm' ? 6 : 3.5));
        m.ring.scale.set(s, s, 1);
        m.ring.material.opacity = 0.75 - 0.35 * Math.sin(clockT * 4);
        m.ring.visible = true;
      } else {
        m.ring.visible = false;
      }
    });

    // 雷达扫描
    radarBeams.forEach(function (b) {
      b.pivot.rotation.y = b.baseAim + Math.sin(clockT * 0.55 + b.phase) * 0.5;
    });

    controls.update();
    renderer.render(scene, camera);
  }

  function onResize() {
    if (!containerEl) return;
    var w = containerEl.clientWidth, h = containerEl.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  /* ---------------- 对外接口 ---------------- */
  var Scene3D = {
    onPointClick: null,
    init: init,
    flyTo: flyTo,
    focusPoint: focusPoint,
    selectPoint: function (id) {
      if (selectedId && markerGroups[selectedId]) markerGroups[selectedId].sel.visible = false;
      selectedId = id;
      if (id && markerGroups[id]) markerGroups[id].sel.visible = true;
    },
    updatePoint: function (p) {
      var m = markerGroups[p.id];
      if (!m) return;
      m.head.material.color.set(p.cur.status.color);
      m.head.material.emissive.set(p.cur.status.color);
      m.ring.material.color.set(p.cur.status.color);
      drawLabel(m.label, p);
    },
    updateAll: function () {
      D.POINTS.forEach(function (p) { Scene3D.updatePoint(p); });
    }
  };

  global.Scene3D = Scene3D;
})(window);
