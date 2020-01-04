
import * as Viewer from '../viewer';
import * as RARC from '../Common/JSYSTEM/JKRArchive';

import { WindWakerRenderer, WindWakerRoomRenderer, WindWakerPass, ZWWExtraTextures, dGlobals } from "./zww_scenes";
import { mat4, vec3 } from "gl-matrix";
import { J3DModelInstanceSimple, BMDModelMaterialData, J3DModelData } from '../Common/JSYSTEM/J3D/J3DGraphBase';
import { GfxRendererLayer } from '../gfx/render/GfxRenderer';
import { BMT, LoopMode, ANK1, TTK1, TRK1, TPT1 } from '../Common/JSYSTEM/J3D/J3DLoader';
import * as DZB from './DZB';
import { assertExists, hexzero, leftPad } from '../util';
import { ResType } from './d_resorce';
import AnimationController from '../AnimationController';
import { AABB } from '../Geometry';
import { computeModelMatrixSRT } from '../MathHelpers';
import { LightType, dKy_tevstr_init, dKy_tevstr_c, settingTevStruct, setLightTevColorType } from './d_kankyo';
import { JPABaseEmitter } from '../Common/JSYSTEM/JPA';
import { fpc__ProcessName, fopAcM_prm_class, fpcSCtRq_Request } from './framework';
import { ScreenSpaceProjection, computeScreenSpaceProjectionFromWorldSpaceAABB } from '../Camera';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderer';

const scratchMat4a = mat4.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();

function animFrame(frame: number): AnimationController { const a = new AnimationController(); a.setTimeInFrames(frame); return a; }

function computeActorModelMatrix(m: mat4, actor: PlacedActor): void {
    computeModelMatrixSRT(m,
        actor.scale![0], actor.scale![1], actor.scale![2],
        0, actor.rotationY, 0,
        actor.pos![0], actor.pos![1], actor.pos![2]);
}

export function spawnLegacyActor(renderer: WindWakerRenderer, roomRenderer: WindWakerRoomRenderer, actor: PlacedActor) {
    const modelCache = renderer.globals.modelCache;
    const resCtrl = modelCache.resCtrl;

    function fetchArchive(objArcName: string): Promise<RARC.JKRArchive> {
        return modelCache.fetchObjectData(objArcName);
    }

    function buildChildModel(rarc: RARC.JKRArchive, modelPath: string): BMDObjectRenderer {
        const model = modelCache.getModel(rarc, modelPath);
        const modelInstance = new J3DModelInstanceSimple(model);
        modelInstance.passMask = WindWakerPass.MAIN;
        renderer.extraTextures.fillExtraTextures(modelInstance);
        modelInstance.name = actor.name;
        modelInstance.setSortKeyLayer(GfxRendererLayer.OPAQUE + 1);
        const objectRenderer = new BMDObjectRenderer(modelInstance);
        dKy_tevstr_init(objectRenderer.tevstr, actor.roomNo);
        objectRenderer.layer = actor.layer;
        return objectRenderer;
    }

    function setModelMatrix(m: mat4): void {
        computeActorModelMatrix(m, actor);
    }

    function buildModel(rarc: RARC.JKRArchive, modelPath: string): BMDObjectRenderer {
        const objectRenderer = buildChildModel(rarc, modelPath);
        setModelMatrix(objectRenderer.modelMatrix);
        roomRenderer.objectRenderers.push(objectRenderer);
        return objectRenderer;
    }

    function buildModelRes(context: WindWakerRenderer, modelData: J3DModelData, actor: PlacedActor): BMDObjectRenderer {
        const modelInstance = new J3DModelInstanceSimple(modelData);
        modelInstance.passMask = WindWakerPass.MAIN;
        context.extraTextures.fillExtraTextures(modelInstance);
        modelInstance.setSortKeyLayer(GfxRendererLayer.OPAQUE + 1);
        const objectRenderer = new BMDObjectRenderer(modelInstance);
        dKy_tevstr_init(objectRenderer.tevstr, actor.roomNo);
        objectRenderer.layer = actor.layer;
        setModelMatrix(objectRenderer.modelMatrix);
        actor.roomRenderer.objectRenderers.push(objectRenderer);
        return objectRenderer;
    }


    function buildModelBMT(rarc: RARC.JKRArchive, modelPath: string, bmtPath: string): BMDObjectRenderer {
        const objectRenderer = buildModel(rarc, modelPath);
        const bmt = BMT.parse(rarc.findFileData(bmtPath)!);
        const cache = renderer.renderHelper.renderInstManager.gfxRenderCache;
        objectRenderer.modelInstance.setModelMaterialData(new BMDModelMaterialData(renderer.device, cache, bmt));
        renderer.extraTextures.fillExtraTextures(objectRenderer.modelInstance);
        return objectRenderer;
    }

    function setToNearestFloor(dstMatrix: mat4, localModelMatrix: mat4) {
        mat4.getTranslation(scratchVec3a, localModelMatrix);
        vec3.set(scratchVec3b, 0, -1, 0);
        const found = DZB.raycast(scratchVec3b, roomRenderer.dzb, scratchVec3a, scratchVec3b);
        if (found)
            dstMatrix[13] = scratchVec3b[1];
    }

    function parseBCK(rarc: RARC.JKRArchive, path: string) {
        const resInfo = assertExists(resCtrl.findResInfoByArchive(rarc, resCtrl.resObj));
        const g = resInfo.lazyLoadResource(ResType.Bck, assertExists(resInfo.res.find((res) => path.endsWith(res.file.name))));
        g.loopMode = LoopMode.REPEAT;
        return g;
    }

    function parseBRK(rarc: RARC.JKRArchive, path: string) {
        const resInfo = assertExists(resCtrl.findResInfoByArchive(rarc, resCtrl.resObj));
        return resInfo.lazyLoadResource(ResType.Brk, assertExists(resInfo.res.find((res) => path.endsWith(res.file.name))));
    }

    function parseBTK(rarc: RARC.JKRArchive, path: string) {
        const resInfo = assertExists(resCtrl.findResInfoByArchive(rarc, resCtrl.resObj));
        return resInfo.lazyLoadResource(ResType.Btk, assertExists(resInfo.res.find((res) => path.endsWith(res.file.name))));
    }

    function parseBTP(rarc: RARC.JKRArchive, path: string) {
        const resInfo = assertExists(resCtrl.findResInfoByArchive(rarc, resCtrl.resObj));
        return resInfo.lazyLoadResource(ResType.Btp, assertExists(resInfo.res.find((res) => path.endsWith(res.file.name))));
    }

    function createEmitter(context: WindWakerRenderer, resourceId: number): JPABaseEmitter {
        const emitter = context.effectSystem!.createBaseEmitter(context.device, context.renderCache, resourceId);
        // TODO(jstpierre): Scale, Rotation
        return emitter;
    }

    const globals = renderer.globals;

    const objName = globals.dStage_searchName(actor.name);
    const pcName = objName.pcName;

    // Tremendous special thanks to LordNed, Sage-of-Mirrors & LagoLunatic for their work on actor mapping
    // Heavily based on https://github.com/LordNed/Winditor/blob/master/Editor/resources/ActorDatabase.json

    if (pcName === fpc__ProcessName.d_a_tbox) fetchArchive(`Dalways`).then(() => {
        const type = (actor.parameters >>> 20) & 0x0F;
        if (type === 0) {
            // Light Wood
            const res = globals.resCtrl.getObjectRes(ResType.Model, `Dalways`, 0x0E);
            const m = buildModelRes(globals.renderer, res, actor);
        } else if (type === 1) {
            // Dark Wood
            const res = globals.resCtrl.getObjectRes(ResType.Model, `Dalways`, 0x0F);
            const m = buildModelRes(globals.renderer, res, actor);
        } else if (type === 2) {
            // Metal
            const res = globals.resCtrl.getObjectRes(ResType.Model, `Dalways`, 0x10);
            const m = buildModelRes(globals.renderer, res, actor);
            const b = globals.resCtrl.getObjectRes(ResType.Brk, `Dalways`, 0x1D);
            b.loopMode = LoopMode.ONCE;
            m.bindTRK1(b);
        } else if (type === 3) {
            // Big Key
            const res = globals.resCtrl.getObjectRes(ResType.Model, `Dalways`, 0x14);
            const m = buildModelRes(globals.renderer, res, actor);
        } else {
            // Might be something else, not sure.
            console.warn(`Unknown chest type: ${actor.name} / ${actor.roomRenderer.name} Layer ${actor.layer} / ${hexzero(actor.parameters, 8)}`);
        }
    });
    else if (actor.name === 'item') {
        // Item table provided with the help of the incredible LagoLunatic <3.
        const itemId = (actor.parameters & 0x000000FF);

        // Heart
        if (itemId === 0x00) fetchArchive(`Always`).then((rarc) => buildModel(rarc, `bdl/vhrtl.bdl`));
        // Rupee (Green)
        else if (itemId === 0x01) fetchArchive(`Always`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/vlupl.bdl`);
            m.bindTRK1(parseBRK(rarc, `brk/vlupl.brk`), animFrame(0));
            m.bindTTK1(parseBTK(rarc, `btk/vlupl.btk`));
        });
        // Rupee (Blue)
        else if (itemId === 0x02) fetchArchive(`Always`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/vlupl.bdl`);
            m.bindTRK1(parseBRK(rarc, `brk/vlupl.brk`), animFrame(1));
            m.bindTTK1(parseBTK(rarc, `btk/vlupl.btk`));
        });
        // Rupee (Yellow)
        else if (itemId === 0x03) fetchArchive(`Always`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/vlupl.bdl`);
            m.bindTRK1(parseBRK(rarc, `brk/vlupl.brk`), animFrame(2));
            m.bindTTK1(parseBTK(rarc, `btk/vlupl.btk`));
        });
        // Rupee (Red)
        else if (itemId === 0x04) fetchArchive(`Always`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/vlupl.bdl`);
            m.bindTRK1(parseBRK(rarc, `brk/vlupl.brk`), animFrame(3));
            m.bindTTK1(parseBTK(rarc, `btk/vlupl.btk`));
        });
        // Rupee (Purple)
        else if (itemId === 0x05) fetchArchive(`Always`).then((rarc) => {
            const m = buildModel(rarc, `bdlm/vlupl.bdl`);
            m.bindTRK1(parseBRK(rarc, `brk/vlupl.brk`), animFrame(4));
            m.bindTTK1(parseBTK(rarc, `btk/vlupl.btk`));
        });
        // Small magic jar
        else if (itemId === 0x09) fetchArchive(`Always`).then((rarc) => buildModel(rarc, `bdlm/mpoda.bdl`));
        // Large magic jar
        else if (itemId === 0x0A) fetchArchive(`Always`).then((rarc) => buildModel(rarc, `bdlm/mpodb.bdl`));
        // Small key
        else if (itemId === 0x15) fetchArchive(`Always`).then((rarc) => buildModel(rarc, `bdl/vkeyl.bdl`));
        // Joy pendant
        else if (itemId === 0x1F) fetchArchive(`Always`).then((rarc) => buildModel(rarc, `bdl/vhapl.bdl`));
        else console.warn(`Unknown item: ${hexzero(itemId, 2)}`);
    }
    // Heart Container
    else if (actor.name === 'Bitem') fetchArchive(`Always`).then((rarc) => buildModel(rarc, `bdlm/vhutl.bdl`).bindTTK1(parseBTK(rarc, `btk/vhutl.btk`)));
    // Forsaken Fortress warp to Ganon's tower
    else if (actor.name === 'Warpmj') fetchArchive(`Gmjwp`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/gmjwp00.bdl`);
        m.bindTTK1(parseBTK(rarc, `btk/gmjwp00.btk`));
    });
    // NPCs
    // Aryll
    else if (actor.name === 'Ls' || actor.name === 'Ls1') fetchArchive(`Ls`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ls.bdl`);
        buildChildModel(rarc, `bdl/lshand.bdl`).setParentJoint(m, `handL`);
        buildChildModel(rarc, `bdl/lshand.bdl`).setParentJoint(m, `handR`);
        m.bindANK1(parseBCK(rarc, `bcks/ls_wait01.bck`));
    });
    // Beedle
    else if (actor.name === 'Bs1') fetchArchive(`Bs`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bs.bdl`);
        m.bindANK1(parseBCK(rarc, `bcks/bs_wait01.bck`));
    });
    // Beedle (this time with helmet)
    else if (actor.name === 'Bs2') fetchArchive(`Bs`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bs.bdl`);
        buildChildModel(rarc, `bdlm/bs_met.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/bs_wait01.bck`));
    });
    // Tingle
    else if (actor.name === 'Tc') fetchArchive(`Tc`).then((rarc) => buildModel(rarc, `bdlm/tc.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Grandma
    else if (actor.name === 'Ba1') {
        // Only allow the sleeping grandma through, because how else can you live in life...
        if (actor.parameters === 0x03) {
            fetchArchive(`Ba`).then(rarc => {
                const m = buildModel(rarc, `bdlm/ba.bdl`);
                m.bindANK1(parseBCK(rarc, `bcks/wait02.bck`));
            });
        }
    }
    // Salvatore
    else if (actor.name === 'Kg1' || actor.name === 'Kg2') fetchArchive(`Kg`).then((rarc) => buildModel(rarc, `bdlm/kg.bdl`).bindANK1(parseBCK(rarc, `bcks/kg_wait01.bck`)));
    // Orca
    else if (actor.name === 'Ji1') fetchArchive(`Ji`).then((rarc) => buildModel(rarc, `bdlm/ji.bdl`).bindANK1(parseBCK(rarc, `bck/ji_wait01.bck`)));
    // Medli
    else if (actor.name === 'Md1') {
        fetchArchive(`Md`).then(rarc => {
            const m = buildModel(rarc, `bdlm/md.bdl`);
            m.bindANK1(parseBCK(rarc, `bcks/md_wait01.bck`));
            const armL = buildChildModel(rarc, `bdlm/mdarm.bdl`);
            armL.bindANK1(parseBCK(rarc, `bcks/mdarm_wait01.bck`));
            armL.modelInstance.setShapeVisible(1, false);
            armL.setParentJoint(m, `armL`);
            const armR = buildChildModel(rarc, `bdlm/mdarm.bdl`);
            armR.bindANK1(parseBCK(rarc, `bcks/mdarm_wait01.bck`));
            armR.modelInstance.setShapeVisible(0, false);
            armR.setParentJoint(m, `armR`);
        });
    }
    // Makar
    else if (actor.name === 'Cb1') fetchArchive(`Cb`).then((rarc) => {
        const m = buildModel(rarc, `bdl/cb.bdl`);
        buildChildModel(rarc, `bdl/cb_face.bdl`).setParentJoint(m, `backbone`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // The King of Hyrule
    else if (actor.name === 'Hi1') fetchArchive(`Hi`).then((rarc) => buildModel(rarc, `bdlm/hi.bdl`).bindANK1(parseBCK(rarc, `bcks/hi_wait01.bck`)));
    // Princess Zelda
    else if (actor.name === 'p_zelda') fetchArchive(`Pz`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/pz.bdl`);            
        m.setMaterialColorWriteEnabled("m_pz_eyeLdamA", false);
        m.setMaterialColorWriteEnabled("m_pz_eyeLdamB", false);
        m.setMaterialColorWriteEnabled("m_pz_mayuLdamA", false);
        m.setMaterialColorWriteEnabled("m_pz_mayuLdamB", false);
        m.setMaterialColorWriteEnabled("m_pz_eyeRdamA", false);
        m.setMaterialColorWriteEnabled("m_pz_eyeRdamB", false);
        m.setMaterialColorWriteEnabled("m_pz_mayuRdamA", false);
        m.setMaterialColorWriteEnabled("m_pz_mayuRdamB", false);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
    });
    // The Great Deku Tree
    else if (actor.name === 'De1') fetchArchive(`De`).then((rarc) => buildModel(rarc, `bdl/de.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Prince Komali (Small Childe)
    else if (actor.name === 'Co1') fetchArchive(`Co`).then((rarc) => buildModel(rarc, `bdlm/co.bdl`).bindANK1(parseBCK(rarc, `bcks/co_wait00.bck`)));
    // Adult Komali
    else if (actor.name === 'Ac1') fetchArchive(`Ac`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ac.bdl`);
        const armL = buildChildModel(rarc, `bdl/acarm.bdl`);
        armL.setParentJoint(m, `armL`);
        armL.bindANK1(parseBCK(rarc, `bcks/acarm_wait01.bck`));
        const armR = buildChildModel(rarc, `bdl/acarm.bdl`);
        armR.setParentJoint(m, `armR`);
        armR.bindANK1(parseBCK(rarc, `bcks/acarm_wait01.bck`));
        m.bindANK1(parseBCK(rarc, `bcks/ac_wait01.bck`));
    });
    // Rito Chieftan
    else if (actor.name === 'Zk1') fetchArchive(`Zk`).then((rarc) => buildModel(rarc, `bdlm/zk.bdl`).bindANK1(parseBCK(rarc, `bcks/zk_wait01.bck`)));
    // Rose
    else if (actor.name === 'Ob1') fetchArchive(`Ob`).then((rarc) => {
        const m = buildModel(rarc, `bdl/ob.bdl`);
        buildChildModel(rarc, `bdlm/oba_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait.bck`));
    });
    // Mesa
    else if (actor.name === 'Ym1') fetchArchive(`Ym`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ym.bdl`);
        buildChildModel(rarc, `bdlm/ymhead01.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
    });
    // Abe
    else if (actor.name === 'Ym2') fetchArchive(`Ym`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdlm/ym.bdl`, `bmt/ym2.bmt`);
        buildChildModel(rarc, `bdlm/ymhead02.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
    });
    // Sturgeon
    else if (actor.name === 'Aj1') fetchArchive(`Aj`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/aj.bdl`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
    });
    // Quill
    else if (actor.name === 'Bm1') fetchArchive(`Bm`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bm.bdl`);
        const head = buildChildModel(rarc, `bdlm/bmhead01.bdl`);
        head.setParentJoint(m, `head`);
        head.bindANK1(parseBCK(rarc, `bcks/bmhead01_wait01.bck`));
        const armL = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armL.setParentJoint(m, `armL`);
        armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
        const armR = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armR.setParentJoint(m, `armR`);
        armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
        m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`));
    });
    // (Unnamed Rito)
    else if (actor.name === 'Bm2') fetchArchive(`Bm`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bm.bdl`);
        const head = buildChildModel(rarc, `bdlm/bmhead02.bdl`);
        head.setParentJoint(m, `head`);
        head.bindANK1(parseBCK(rarc, `bcks/bmhead01_wait01.bck`));
        const armL = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armL.setParentJoint(m, `armL`);
        armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
        const armR = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armR.setParentJoint(m, `armR`);
        armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
        m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`));
    });
    // (Unnamed Rito)
    else if (actor.name === 'Bm3') fetchArchive(`Bm`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bm.bdl`);
        const head = buildChildModel(rarc, `bdlm/bmhead03.bdl`);
        head.setParentJoint(m, `head`);
        head.bindANK1(parseBCK(rarc, `bcks/bmhead01_wait01.bck`));
        const armL = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armL.setParentJoint(m, `armL`);
        armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
        const armR = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armR.setParentJoint(m, `armR`);
        armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
        m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`));
    });
    // (Unnamed Rito)
    else if (actor.name === 'Bm4') fetchArchive(`Bm`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bm.bdl`);
        const head = buildChildModel(rarc, `bdlm/bmhead04.bdl`);
        head.setParentJoint(m, `head`);
        head.bindANK1(parseBCK(rarc, `bcks/bmhead01_wait01.bck`));
        const armL = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armL.setParentJoint(m, `armL`);
        armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
        const armR = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armR.setParentJoint(m, `armR`);
        armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
        m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`));
    });
    // (Unnamed Rito)
    else if (actor.name === 'Bm5') fetchArchive(`Bm`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bm.bdl`);
        const head = buildChildModel(rarc, `bdlm/bmhead05.bdl`);
        head.setParentJoint(m, `head`);
        head.bindANK1(parseBCK(rarc, `bcks/bmhead01_wait01.bck`));
        const armL = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armL.setParentJoint(m, `armL`);
        armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
        const armR = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armR.setParentJoint(m, `armR`);
        armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`));
        m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`));
    });
    // Baito (Sorting Game)
    else if (actor.name === 'Btsw2') fetchArchive(`Btsw`).then((rarc) => buildModel(rarc, `bdlm/bn.bdl`).bindANK1(parseBCK(rarc, `bcks/bn_wait01.bck`)));
    // Koboli (Sorting Game)
    else if (actor.name === 'Bmsw') fetchArchive(`Bmsw`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bm.bdl`);
        buildChildModel(rarc, `bdlm/bmhead11.bdl`).setParentJoint(m, `head`);
        const armL = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armL.setParentJoint(m, `armL`);
        armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`))
        const armR = buildChildModel(rarc, `bdlm/bmarm.bdl`);
        armR.setParentJoint(m, `armR`);
        armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`))
        m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`))
    });
    // Obli
    else if (actor.name === 'Bmcon1') fetchArchive(`Bmcon1`).then((rarc) => {
        const m = buildModel(rarc, `bdl/bm.bdl`);
        buildChildModel(rarc, `bdlm/bmhead08.bdl`).setParentJoint(m, `head`);
        const armL = buildChildModel(rarc, `bdl/bmarm.bdl`);
        armL.setParentJoint(m, `armL`);
        armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`))
        const armR = buildChildModel(rarc, `bdl/bmarm.bdl`);
        armR.setParentJoint(m, `armR`);
        armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`))
        m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`));
    });
    // Obli
    else if (actor.name === 'Bmcon2') fetchArchive(`Bmcon1`).then((rarc) => {
        const m = buildModel(rarc, `bdl/bm.bdl`);
        buildChildModel(rarc, `bdlm/bmhead10.bdl`).setParentJoint(m, `head`);
        const armL = buildChildModel(rarc, `bdl/bmarm.bdl`);
        armL.setParentJoint(m, `armL`);
        armL.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`))
        const armR = buildChildModel(rarc, `bdl/bmarm.bdl`);
        armR.setParentJoint(m, `armR`);
        armR.bindANK1(parseBCK(rarc, `bcks/bmarm_wait01.bck`))
        m.bindANK1(parseBCK(rarc, `bcks/bm_wait01.bck`));
    });
    // Zill
    else if (actor.name === 'Ko1') fetchArchive(`Ko`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ko.bdl`);
        buildChildModel(rarc, `bdlm/kohead01.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ko_wait01.bck`));
    });
    // Joel
    else if (actor.name === 'Ko2') fetchArchive(`Ko`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdlm/ko.bdl`, `bmt/ko02.bmt`);
        buildChildModel(rarc, `bdlm/kohead02.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ko_wait01.bck`));
    });
    // Sue-Belle
    else if (actor.name === 'Yw1') fetchArchive(`Yw`).then((rarc) => {
        const m = buildModel(rarc, `bdl/yw.bdl`);
        buildChildModel(rarc, `bdlm/ywhead01.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
    });
    // Tetra
    else if (actor.name === 'Zl1') fetchArchive(`Zl`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/zl.bdl`);
        m.setMaterialColorWriteEnabled("eyeLdamA", false);
        m.setMaterialColorWriteEnabled("eyeLdamB", false);
        m.setMaterialColorWriteEnabled("mayuLdamA", false);
        m.setMaterialColorWriteEnabled("mayuLdamB", false);
        m.setMaterialColorWriteEnabled("eyeRdamA", false);
        m.setMaterialColorWriteEnabled("eyeRdamB", false);
        m.setMaterialColorWriteEnabled("mayuRdamA", false);
        m.setMaterialColorWriteEnabled("mayuRdamB", false);
        m.bindANK1(parseBCK(rarc, `bcks/wait.bck`));
    });
    // Gonzo
    else if (actor.name === 'P1a') fetchArchive(`P1`).then((rarc) => {
        const m = buildModel(rarc, `bdl/p1.bdl`);
        buildChildModel(rarc, `bdlm/p1a_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait.bck`));
    });
    // Senza
    else if (actor.name === 'P1b') fetchArchive(`P1`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/p1.bdl`, `bmt/p1b_body.bmt`);
        buildChildModel(rarc, `bdlm/p1b_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait.bck`));
    });
    // Nudge
    else if (actor.name === 'P1c') fetchArchive(`P1`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/p1.bdl`, `bmt/p1c_body.bmt`);
        buildChildModel(rarc, `bdlm/p1c_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait.bck`));
    });
    // Zuko
    else if (actor.name === 'P2a') fetchArchive(`P2`).then((rarc) => {
        const m = buildModel(rarc, `bdl/p2.bdl`);
        buildChildModel(rarc, `bdlm/p2head01.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/p2_wait01.bck`));
    });
    // Niko
    else if (actor.name === 'P2b') fetchArchive(`P2`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/p2.bdl`, `bmt/p2b.bmt`);
        buildChildModel(rarc, `bdlm/p2head02.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/p2_wait01.bck`));
    });
    // Mako
    else if (actor.name === 'P2c') fetchArchive(`P2`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/p2.bdl`, `bmt/p2c.bmt`);
        buildChildModel(rarc, `bdlm/p2head03.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/p2_wait01.bck`));
    });
    // Old Man Ho-Ho
    else if (actor.name === 'Ah') fetchArchive(`Ah`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ah.bdl`);
        m.bindANK1(parseBCK(rarc, `bcks/ah_wait01.bck`));
    });
    // Helmarock King
    else if (actor.name === 'Dk') fetchArchive(`Dk`).then((rarc) => {
        const m = buildModel(rarc, `bdl/dk.bdl`);
        m.bindANK1(parseBCK(rarc, `bcks/fly1.bck`));
    });
    // Zunari
    else if (actor.name === 'Rsh1') fetchArchive(`Rsh`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/rs.bdl`);
        m.bindANK1(parseBCK(rarc, `bck/rs_wait01.bck`));
    });
    // ???
    else if (actor.name === 'Sa1') fetchArchive(`Sa`).then((rarc) => {
        const m = buildModel(rarc, `bdl/sa.bdl`);
        buildChildModel(rarc, `bdlm/sa01_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
    });
    // Gummy
    else if (actor.name === 'Sa2') fetchArchive(`Sa`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/sa.bdl`, `bmt/sa02.bmt`);
        buildChildModel(rarc, `bdlm/sa02_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
    });
    // Kane
    else if (actor.name === 'Sa3') fetchArchive(`Sa`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/sa.bdl`, `bmt/sa03.bmt`);
        buildChildModel(rarc, `bdlm/sa03_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
    });
    // Candy
    else if (actor.name === 'Sa4') fetchArchive(`Sa`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/sa.bdl`, `bmt/sa04.bmt`);
        buildChildModel(rarc, `bdlm/sa04_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
    });
    // Dampa
    else if (actor.name === 'Sa5') fetchArchive(`Sa`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/sa.bdl`, `bmt/sa05.bmt`);
        buildChildModel(rarc, `bdlm/sa05_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/sa_wait01.bck`));
    });
    // Potova
    else if (actor.name === 'Ug1') fetchArchive(`Ug`).then((rarc) => {
        const m = buildModel(rarc, `bdl/ug.bdl`);
        buildChildModel(rarc, `bdlm/ug01_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ug_wait01.bck`));
    });
    // Joanna
    else if (actor.name === 'Ug2') fetchArchive(`Ug`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/ug.bdl`, `bmt/ug02.bmt`);
        buildChildModel(rarc, `bdlm/ug02_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ug_wait01.bck`));
    });
    // Jin
    else if (actor.name === 'UkB') fetchArchive(`Uk`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/uk.bdl`);
        buildChildModel(rarc, `bdl/ukhead_b.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uk_wait.bck`));
    });
    // Jan
    else if (actor.name === 'UkC') fetchArchive(`Uk`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdlm/uk.bdl`, `bmt/uk_c.bmt`);
        buildChildModel(rarc, `bdlm/ukhead_c.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uk_wait.bck`));
    });
    // Jun-Roberto
    else if (actor.name === 'UkD') fetchArchive(`Uk`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdlm/uk.bdl`, `bmt/uk_d.bmt`);
        buildChildModel(rarc, `bdl/ukhead_d.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uk_wait.bck`));
    });
    // Gilligan
    else if (actor.name === 'Uw1') fetchArchive(`Uw`).then((rarc) => {
        const m = buildModel(rarc, `bdl/uw.bdl`);
        buildChildModel(rarc, `bdlm/uw01_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uw_wait01.bck`));
    });
    // Linda
    else if (actor.name === 'Uw2') fetchArchive(`Uw`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/uw.bdl`, `bmt/uw02.bmt`);
        buildChildModel(rarc, `bdlm/uw02_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uw_wait01.bck`));
    });
    // Kreeb
    else if (actor.name === 'Um1') fetchArchive(`Um`).then((rarc) => {
        const m = buildModel(rarc, `bdl/um.bdl`);
        buildChildModel(rarc, `bdlm/um01_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/um_wait01.bck`));
    });
    // Anton
    else if (actor.name === 'Um2') fetchArchive(`Um`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/um.bdl`, `bmt/um02.bmt`);
        buildChildModel(rarc, `bdlm/um02_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/um_wait01.bck`));
    });
    // Kamo
    else if (actor.name === 'Um3') fetchArchive(`Um`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/um.bdl`, `bmt/um03.bmt`);
        buildChildModel(rarc, `bdlm/um03_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/um_wait01.bck`));
    });
    // Sam
    else if (actor.name === 'Uo1') fetchArchive(`Uo`).then((rarc) => {
        const m = buildModel(rarc, `bdl/uo.bdl`);
        buildChildModel(rarc, `bdlm/uo01_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uo_wait01.bck`));
    });
    // Gossack
    else if (actor.name === 'Uo2') fetchArchive(`Uo`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/uo.bdl`, `bmt/uo02.bmt`);
        buildChildModel(rarc, `bdlm/uo02_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uo_wait01.bck`));
    });
    // Garrickson
    else if (actor.name === 'Uo3') fetchArchive(`Uo`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/uo.bdl`, `bmt/uo03.bmt`);
        buildChildModel(rarc, `bdlm/uo03_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/uo_wait01.bck`));
    });
    // Vera
    else if (actor.name === 'Ub1') fetchArchive(`Ub`).then((rarc) => {
        const m = buildModel(rarc, `bdl/ub.bdl`);
        buildChildModel(rarc, `bdlm/ub01_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ub_wait01.bck`));
    });
    // Pompie
    else if (actor.name === 'Ub2') fetchArchive(`Ub`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/ub.bdl`, `bmt/ub02.bmt`);
        buildChildModel(rarc, `bdlm/ub02_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ub_wait01.bck`));
    });
    // Missy
    else if (actor.name === 'Ub3') fetchArchive(`Ub`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/ub.bdl`, `bmt/ub03.bmt`);
        buildChildModel(rarc, `bdlm/ub03_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ub_wait01.bck`));
    });
    // Mineco
    else if (actor.name === 'Ub4') fetchArchive(`Ub`).then((rarc) => {
        const m = buildModelBMT(rarc, `bdl/ub.bdl`, `bmt/ub04.bmt`);
        buildChildModel(rarc, `bdlm/ub04_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ub_wait01.bck`));
    });
    // Bomb-Master Cannon (1)
    else if (actor.name === 'Bms1') fetchArchive(`Bms`).then((rarc) => {
        const m = buildModel(rarc, `bdl/by1.bdl`);
        buildChildModel(rarc, `bdlm/by_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/by1_wait01.bck`));
    });
    // Bomb-Master Cannon (1)
    else if (actor.name === 'Bms2') fetchArchive(`Bms`).then((rarc) => {
        const m = buildModel(rarc, `bdl/by2.bdl`);
        buildChildModel(rarc, `bdlm/by_head.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/by2_wait00.bck`));
    });
    // Mrs. Marie
    else if (actor.name === 'Ho') fetchArchive(`Ho`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ho.bdl`);
        buildChildModel(rarc, `bdl/ho_pend.bdl`).setParentJoint(m, `backbone`);
        m.bindANK1(parseBCK(rarc, `bcks/ho_wait01.bck`));
    });
    // Tott
    else if (actor.name === 'Tt') fetchArchive(`Tt`).then((rarc) => buildModel(rarc, `bdlm/tt.bdl`).bindANK1(parseBCK(rarc, `bck/wait01.bck`)));
    // Maggie's Father (Rich)
    else if (actor.name === 'Gp1') fetchArchive(`Gp`).then((rarc) => buildModel(rarc, `bdlm/gp.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Maggie's Father (Poor)
    else if (actor.name === 'Pf1') fetchArchive(`Pf`).then((rarc) => buildModel(rarc, `bdlm/pf.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Maggie (Rich)
    else if (actor.name === 'Kp1') fetchArchive(`Kp`).then((rarc) => buildModel(rarc, `bdlm/kp.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Mila (Poor)
    else if (actor.name === 'Kk1') fetchArchive(`Kk`).then((rarc) => buildModel(rarc, `bdlm/kk.bdl`).bindANK1(parseBCK(rarc, `bcks/kk_wait01.bck`)));
    // Mila's Father (Rich)
    else if (actor.name === 'Kf1') fetchArchive(`Kf`).then((rarc) => buildModel(rarc, `bdlm/kf.bdl`).bindANK1(parseBCK(rarc, `bcks/kf_wait01.bck`)));
    // Mila's Father (Poor)
    else if (actor.name === 'Gk1') fetchArchive(`Gk`).then((rarc) => buildModel(rarc, `bdlm/gk.bdl`).bindANK1(parseBCK(rarc, `bcks/gk_wait01.bck`)));
    // Ivan
    else if (actor.name === 'Mk') fetchArchive(`Mk`).then((rarc) => buildModel(rarc, `bdlm/mk.bdl`).bindANK1(parseBCK(rarc, `bcks/mk_wait.bck`)));
    // Lorenzo
    else if (actor.name === 'Po') fetchArchive(`Po`).then((rarc) => buildModel(rarc, `bdlm/po.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Doc Bandam
    else if (actor.name === 'Ds1') fetchArchive(`Ds`).then((rarc) => buildModel(rarc, `bdlm/ck.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Jabun
    else if (actor.name === 'Jb1') fetchArchive(`Jb`).then((rarc) => buildModel(rarc, `bdlm/jb.bdl`).bindANK1(parseBCK(rarc, `bcks/jb_wait01.bck`)));
    // Zephos
    else if (actor.name === 'Hr') fetchArchive(`Hr`).then((rarc) => buildModel(rarc, `bdlm/hr.bdl`).bindANK1(parseBCK(rarc, `bcks/r_wait01.bck`)));
    // Cyclos (same as Zephos)
    else if (actor.name === 'Hr2') fetchArchive(`Hr`).then((rarc) => buildModel(rarc, `bdlm/hr.bdl`).bindANK1(parseBCK(rarc, `bcks/r_wait01.bck`)));
    // Valoo
    else if (actor.name === 'dragon') fetchArchive(`Dr`).then((rarc) => buildModel(rarc, `bmd/dr1.bmd`).bindANK1(parseBCK(rarc, `bck/dr_wait1.bck`)));
    // Olivio (Korok)
    else if (actor.name === 'Bj1') fetchArchive(`Bj`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj1_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Aldo (Korok)
    else if (actor.name === 'Bj2') fetchArchive(`Bj`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj2_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Oakin (Korok)
    else if (actor.name === 'Bj3') fetchArchive(`Bj`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj3_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Drona (Korok)
    else if (actor.name === 'Bj4') fetchArchive(`Bj`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj4_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Irch (Korok)
    else if (actor.name === 'Bj5') fetchArchive(`Bj`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj5_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Rown (Korok)
    else if (actor.name === 'Bj6') fetchArchive(`Bj`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj6_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Hollo (Korok)
    else if (actor.name === 'Bj7') fetchArchive(`Bj`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj7_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Elma (Korok)
    else if (actor.name === 'Bj8') fetchArchive(`Bj`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj8_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`))
    });
    // Linder (Korok)
    else if (actor.name === 'Bj9') fetchArchive(`Bj`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bj.bdl`);
        buildChildModel(rarc, `bdl/bj9_face.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/wait01.bck`));
    });
    // Manny
    else if (actor.name === 'Mn') fetchArchive(`Mn`).then((rarc) => buildModel(rarc, `bdlm/mn.bdl`).bindANK1(parseBCK(rarc, `bcks/mn_wait01.bck`)));
    // Carlov
    else if (actor.name === 'Mt') fetchArchive(`Niten`).then((rarc) => buildModel(rarc, `bdlm/mt.bdl`).bindANK1(parseBCK(rarc, `bcks/mt_wait01.bck`)));
    // Great Fairy
    else if (actor.name === 'BigElf') fetchArchive(`bigelf`).then((rarc) => buildModel(rarc, `bdlm/dy.bdl`).bindANK1(parseBCK(rarc, `bcks/wait01.bck`)));
    // Fairy
    else if (actor.name === 'Sfairy') fetchArchive(`Always`).then((rarc) => buildModel(rarc, `bdl/fa.bdl`).bindANK1(parseBCK(rarc, `bck/fa.bck`)));
    // Goron Merchants
    else if (actor.name === 'RotenA') fetchArchive(`Ro`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ro.bdl`);
        buildChildModel(rarc, `bdl/ro_hat.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ro_wait01.bck`));
    });
    else if (actor.name === 'RotenB') fetchArchive(`Ro`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ro.bdl`);
        buildChildModel(rarc, `bdl/ro_hat2.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ro_wait01.bck`));
    });
    else if (actor.name === 'RotenC') fetchArchive(`Ro`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/ro.bdl`);
        buildChildModel(rarc, `bdl/ro_hat3.bdl`).setParentJoint(m, `head`);
        m.bindANK1(parseBCK(rarc, `bcks/ro_wait01.bck`));
    });
    // Hyrule Ocean Warp
    else if (actor.name === 'Ghrwp') fetchArchive(`Ghrwp`).then((rarc) => {
        const a00 = buildModel(rarc, `bdlm/ghrwpa00.bdl`);
        a00.bindTTK1(parseBTK(rarc, `btk/ghrwpa00.btk`));
        const b00 = buildModel(rarc, `bdlm/ghrwpb00.bdl`);
        b00.bindTTK1(parseBTK(rarc, `btk/ghrwpb00.btk`));
        b00.bindTRK1(parseBRK(rarc, `brk/ghrwpb00.brk`));
    });
    // Various liftable objects
    else if (
        actor.name === 'kotubo' || actor.name === 'ootubo1' || actor.name === 'Kmtub' ||
        actor.name === 'Ktaru'  || actor.name === 'Ostool'  || actor.name === 'Odokuro' ||
        actor.name === 'Okioke'  || actor.name === 'Kmi02'   || actor.name === 'Ptubo' ||
        actor.name === 'KkibaB'   || actor.name === 'Kmi00'   || actor.name === 'Hbox2S'
    ) {
        const type = (actor.parameters & 0x0F000000) >> 24;
        let model;
        switch (type) {
        case 0:
            // Small Pot
            fetchArchive(`Always`).then((rarc) => {
                model = buildModel(rarc, `bdl/obm_kotubo1.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        case 1:
            // Large Pot
            fetchArchive(`Always`).then((rarc) => {
                model = buildModel(rarc, `bdl/obm_ootubo1.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        case 2:
            // Water Pot
            fetchArchive(`Kmtub_00`).then((rarc) => {
                model = buildModel(rarc, `bdl/kmtub_00.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        case 3:
            // Barrel
            fetchArchive(`Ktaru_01`).then((rarc) => {
                model = buildModel(rarc, `bdl/ktaru_01.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        case 4:
            // Stool
            fetchArchive(`Okmono`).then((rarc) => {
                model = buildModel(rarc, `bdl/ostool.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        case 5:
            // Skull
            fetchArchive(`Odokuro`).then((rarc) => {
                model = buildModel(rarc, `bdl/odokuro.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        case 6:
            // Bucket
            fetchArchive(`Okioke`).then((rarc) => {
                model = buildModel(rarc, `bdl/okioke.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        case 7:
            // Nut
            fetchArchive(`Kmi00x`).then((rarc) => {
                model = buildModel(rarc, `bdl/kmi_00x.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        case 8:
            // Golden Crate
            fetchArchive(`Hbox2`).then((rarc) => {
                model = buildModel(rarc, `bdl/hbox2.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        case 13:
            // Seed
            fetchArchive(`Sitem`).then((rarc) => {
                model = buildModel(rarc, `bdl/kmi_02.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        case 14:
            // Fancy Pot
            fetchArchive(`Ptubo`).then((rarc) => {
                model = buildModel(rarc, `bdl/ptubo.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        case 15:
            // Wooden Crate
            fetchArchive(`Kkiba_00`).then((rarc) => {
                model = buildModel(rarc, `bdl/kkiba_00.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        default:
            // Blue Tower of the Gods Pillar Statue
            fetchArchive(`Hseki`).then((rarc) => {
                model = buildModel(rarc, `bdlm/hmon1.bdl`);
                setToNearestFloor(model.modelMatrix, model.modelMatrix);
            });
            break;
        }
    }
    // Outset Island: Jabun's barrier (six parts)
    else if (actor.name === 'Ajav') fetchArchive(`Ajav`).then((rarc) => {
        // Seems like there's one texture that's shared for all parts in ajava.bdl
        // ref. daObjAjav::Act_c::set_tex( (void))
        const ja = buildModel(rarc, `bdl/ajava.bdl`);
        const txa = ja.modelInstance.getTextureMappingReference('Txa_jav_a')!;
        const jb = buildModel(rarc, `bdl/ajavb.bdl`);
        jb.modelInstance.getTextureMappingReference('dmTxa_jav_a')!.copy(txa);
        const jc = buildModel(rarc, `bdl/ajavc.bdl`);
        jc.modelInstance.getTextureMappingReference('dmTxa_jav_a')!.copy(txa);
        const jd = buildModel(rarc, `bdl/ajavd.bdl`);
        jd.modelInstance.getTextureMappingReference('dmTxa_jav_a')!.copy(txa);
        const je = buildModel(rarc, `bdl/ajave.bdl`);
        je.modelInstance.getTextureMappingReference('dmTxa_jav_a')!.copy(txa);
        const jf = buildModel(rarc, `bdl/ajavf.bdl`);
        jf.modelInstance.getTextureMappingReference('dmTxa_jav_a')!.copy(txa);
    });
    else if (actor.name === 'koisi1') fetchArchive(`Always`).then((rarc) => buildModel(rarc, `bdl/obm_ootubo1.bdl`));
    // Bigger trees
    else if (actor.name === 'lwood') fetchArchive(`Lwood`).then((rarc) => {
        const b = buildModel(rarc, `bdl/alwd.bdl`);
        b.lightTevColorType = LightType.BG0;
    });
    else if (actor.name === 'Oyashi') fetchArchive(`Oyashi`).then((rarc) => buildModel(rarc, `bdl/oyashi.bdl`));
    else if (actor.name === 'Vyasi') fetchArchive(`Vyasi`).then((rarc) => buildModel(rarc, `bdl/vyasi.bdl`));
    // Barrels
    else if (actor.name === 'Ktarux') fetchArchive(`Ktaru_01`).then((rarc) => buildModel(rarc, `bdl/ktaru_01.bdl`));
    else if (actor.name === 'Ktaruo') fetchArchive(`Ktaru_01`).then((rarc) => buildModel(rarc, `bdl/ktaru_01.bdl`));
    // Breakable shelves
    else if (actor.name === 'Otana') fetchArchive(`Otana`).then((rarc) => buildModel(rarc, `bdl/otana.bdl`));
    // Mailbox
    else if (actor.name === 'Tpost') fetchArchive(`Toripost`).then((rarc) => buildModel(rarc, `bdl/vpost.bdl`).bindANK1(parseBCK(rarc, `bcks/post_wait.bck`)));
    // Sign
    else if (actor.name === 'Kanban') fetchArchive(`Kanban`).then((rarc) => {
        const b = buildModel(rarc, `bdl/kanban.bdl`);
        b.lightTevColorType = LightType.BG0;
    });
    // Forsaken Fortress door
    else if (actor.name === 'SMBdor') fetchArchive(`Mbdoor`).then((rarc) => {
        // Frame
        const fu = buildModel(rarc, `bdl/s_mbdfu.bdl`);
        fu.lightTevColorType = LightType.BG0;
        // Left door
        const l = buildModel(rarc, `bdl/s_mbd_l.bdl`);
        l.lightTevColorType = LightType.BG0;
        // Right door
        const r = buildModel(rarc, `bdl/s_mbd_r.bdl`);
        r.lightTevColorType = LightType.BG0;
        // Barricade. Not set to the correct default unlocked position.
        const to = buildModel(rarc, `bdl/s_mbdto.bdl`);
        to.lightTevColorType = LightType.BG0;
    });
    // Forsaken Fortress water gate
    else if (actor.name === 'MjDoor') fetchArchive(`S_MSPDo`).then((rarc) => buildModel(rarc, `bdl/s_mspdo.bdl`));
    // Holes you can fall into
    else if (actor.name === 'Pitfall') fetchArchive(`Aana`).then((rarc) => buildModel(rarc, `bdl/aana.bdl`));
    // Warp Pot
    else if (actor.name === 'Warpt' || actor.name === 'Warpnt' || actor.name === 'Warpts1' || actor.name === 'Warpts2' || actor.name === 'Warpts3') fetchArchive(`ltubw`).then((rarc) => buildModel(rarc, `bdl/itubw.bdl`));
    else if (actor.name === 'Warpgm') fetchArchive(`Gmjwp`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/gmjwp00.bdl`);
        m.bindANK1(parseBCK(rarc, `bck/gmjwp01.bck`));
        m.bindTTK1(parseBTK(rarc, `btk/gmjwp00.btk`));
        m.bindTRK1(parseBRK(rarc, `brk/gmjwp01.brk`));
    });
    // Hookshot Target (wtf Nintendo)
    else if (actor.name === 'Hfuck1') fetchArchive(`Hfuck1`).then((rarc) => buildModel(rarc, `bdl/hfuck1.bdl`));
    // Ladders
    else if (actor.name === 'Mhsg4h') fetchArchive(`Mhsg`).then((rarc) => buildModel(rarc, `bdl/mhsg4h.bdl`));
    else if (actor.name === 'Mhsg9') fetchArchive(`Mhsg`).then((rarc) => buildModel(rarc, `bdl/mhsg9.bdl`));
    else if (actor.name === 'Mhsg15') fetchArchive(`Mhsg`).then((rarc) => buildModel(rarc, `bdl/mhsg15.bdl`));
    // Bombable rock
    else if (actor.name === 'Ebrock') fetchArchive(`Ebrock`).then((rarc) => buildModel(rarc, `bdl/ebrock.bdl`));
    else if (actor.name === 'Ebrock2') fetchArchive(`Ebrock`).then((rarc) => buildModel(rarc, `bdl/ebrock2.bdl`));
    else if (actor.name === 'Eskban') fetchArchive(`Eskban`).then((rarc) => buildModel(rarc, `bdl/eskban.bdl`));
    else if (actor.name === 'Esekh') fetchArchive(`Esekh`).then((rarc) => buildModel(rarc, `bdl/esekh.bdl`));
    else if (actor.name === 'Esekh2') fetchArchive(`Esekh`).then((rarc) => buildModel(rarc, `bdl/esekh2.bdl`));
    else if (actor.name === 'Ebomzo') fetchArchive(`Ebomzo`).then((rarc) => buildModel(rarc, `bdl/ebomzo.bdl`));
    // Stone head rock
    else if (actor.name === 'Ekao') fetchArchive(`Ekao`).then((rarc) => buildModel(rarc, `bdl/ekao.bdl`));
    // Whirlpool
    else if (actor.name === 'Auzu') fetchArchive(`Auzu`).then((rarc) => buildModel(rarc, `bdlm/auzu.bdl`).bindTTK1(parseBTK(rarc, `btk/auzu.btk`)));
    // Floor Switch
    else if (actor.name === 'Kbota_A' || actor.name === 'Kbota_B' || actor.name === 'KbotaC') fetchArchive(`Kbota_00`).then((rarc) => buildModel(rarc, `bdl/kbota_00.bdl`));
    // Iron Boots Switch
    else if (actor.name === 'Hhbot1' || actor.name === 'Hhbot1N') fetchArchive(`Hhbot`).then((rarc) => {
        buildModel(rarc, `bdl/hhbot1.bdl`);
        buildModel(rarc, `bdl/hhbot2.bdl`);
    });
    // Spike Trap
    else if (actor.name === 'Trap') fetchArchive(`Trap`).then((rarc) => buildModel(rarc, `bdlm/htora1.bdl`));
    // Floor Spikes
    else if (actor.name === 'Htoge1') fetchArchive(`Htoge1`).then((rarc) => buildModel(rarc, `bdl/htoge1.bdl`));
    // Grapple Point
    else if (actor.name === 'Kui') fetchArchive(`Kui`).then((rarc) => buildModel(rarc, `bdl/obi_ropetag.bdl`));
    // Various pushable objects
    else if (
        actor.name === 'osiBLK0' || actor.name === 'osiBLK1' || actor.name === 'Kkiba' ||
        actor.name === 'Hseki2'  || actor.name === 'Hseki7'  || actor.name === 'Mmrr' ||
        actor.name === 'MkieBB'  || actor.name === 'Ecube'   || actor.name === 'Hjump1' ||
        actor.name === 'Hbox1'   || actor.name === 'MpwrB'   || actor.name === 'DBLK0' ||
        actor.name === 'DBLK1'   || actor.name === 'DKkiba'  || actor.name === 'Hbox2'
    ) {
        const type = (actor.parameters & 0x0F000000) >> 24;
        switch (type) {
        case 0:
        case 4:
        case 8:
        case 9:
            // Wooden Crate
            fetchArchive(`Kkiba_00`).then((rarc) => {
                buildModel(rarc, `bdl/kkiba_00.bdl`);
            });
            break;
        case 1:
        case 11:
            // Black Box
            fetchArchive(`Osiblk`).then((rarc) => {
                buildModel(rarc, `bdl/obm_osihikiblk1.bdl`);
            });
            break;
        case 2:
            // Black Box With Statue on Top
            fetchArchive(`Osiblk`).then((rarc) => {
                buildModel(rarc, `bdl/obm_osihikiblk2.bdl`);
            });
            break;
        case 3:
            // Big Black Box
            fetchArchive(`MpwrB`).then((rarc) => {
                buildModel(rarc, `bdl/mpwrb.bdl`);
            });
            break;
        case 5:
            // Golden Crate
            fetchArchive(`Hbox2`).then((rarc) => {
                buildModel(rarc, `bdl/hbox2.bdl`);
            });
            break;
        case 6:
            // Pushable Metal Box
            fetchArchive(`Hjump`).then((rarc) => {
                buildModel(rarc, `bdl/hbox1.bdl`);
            });
            break;
        case 7:
            // Pushable Metal Box With Spring
            fetchArchive(`Hjump`).then((rarc) => {
                buildModel(rarc, `bdl/hjump1.bdl`);
            });
            break;
        case 10:
            // Mirror
            fetchArchive(`Mmirror`).then((rarc) => {
                buildModel(rarc, `bdlm/mmrr.bdl`).bindTTK1(parseBTK(rarc, `btk/mmrr.btk`));
            });
            break;
        case 12:
            // Mossy Black Box
            fetchArchive(`Ecube`).then((rarc) => {
                buildModel(rarc, `bdl/ecube.bdl`);
            });
            break;
        }
    }
    // Korok Tree
    else if (actor.name === 'FTree') fetchArchive(`Vmr`).then((rarc) => buildModel(rarc, `bdlm/vmrty.bdl`).bindANK1(parseBCK(rarc, `bck/vmrty.bck`)));
    // Animals
    else if (actor.name === 'DmKmm') fetchArchive(`Demo_Kmm`).then((rarc) => buildModel(rarc, `bmd/ka.bmd`).bindANK1(parseBCK(rarc, `bcks/ka_wait1.bck`)));
    else if (actor.name === 'Kamome') fetchArchive(`Kamome`).then((rarc) => buildModel(rarc, `bdl/ka.bdl`).bindANK1(parseBCK(rarc, `bck/ka_wait2.bck`)));
    else if (actor.name === 'kani') fetchArchive(`Kn`).then((rarc) => buildModel(rarc, `bdl/kn.bdl`));
    else if (actor.name === 'Pig') fetchArchive(`Kb`).then((rarc) => buildModel(rarc, `bdlm/pg.bdl`));
    else if (actor.name === 'kani') fetchArchive(`Kn`).then((rarc) => buildModel(rarc, `bdl/kn.bdl`).bindANK1(parseBCK(rarc, `bck/wait01.bck`)));
    else if (actor.name === 'NpcSo') fetchArchive(`So`).then((rarc) => buildModel(rarc, `bdlm/so.bdl`).bindANK1(parseBCK(rarc, `bcks/so_wait01.bck`)));
    // Enemies
    // Phantom Ganon
    else if (actor.name === 'Fganon') fetchArchive(`Fganon`).then((rarc) => buildModel(rarc, `bdlm/bpg.bdl`).bindANK1(parseBCK(rarc, `bck/wait1.bck`)));
    // Gohma
    else if (actor.name === 'Btd') fetchArchive(`btd`).then((rarc) => {
        const m = buildModel(rarc, `bmdm/btd.bmd`);
        m.bindANK1(parseBCK(rarc, `bck/btd_pose.bck`));
        m.bindTRK1(parseBRK(rarc, `brk/btd.brk`));
        m.bindTTK1(parseBTK(rarc, `btk/btd.btk`));
    });
    // Kalle Demos
    else if (actor.name === 'Bkm') fetchArchive(`Bmd`).then((rarc) => {
        buildModel(rarc, `bmdm/bkm.bmd`).bindANK1(parseBCK(rarc, `bck/hiraku_wait.bck`))
        buildModel(rarc, `bmdm/bkm_coa.bmd`).bindANK1(parseBCK(rarc, `bck/coa_wait.bck`))
    });
    // Gohdan
    else if (actor.name === 'Bst') fetchArchive(`Bst`).then((rarc) => {
        const type = (actor.parameters & 0x000000FF);
        switch (type) {
        case 0:
            // Head
            buildModel(rarc, `bdlm/bst.bdl`).bindTTK1(parseBTK(rarc, `btk/bst.btk`))
        break;
        case 1:
            // Left hand
            buildModel(rarc, `bdlm/lhand.bdl`).bindTTK1(parseBTK(rarc, `btk/lhand.btk`))
            break;
        case 2:
            // Right hand
            buildModel(rarc, `bdlm/rhand.bdl`).bindTTK1(parseBTK(rarc, `btk/rhand.btk`))
            break;
        }
    });
    // Jalhalla
    else if (actor.name === 'big_pow') fetchArchive(`Bpw`).then((rarc) => {
        const mainModel = buildModel(rarc, `bdlm/bpw.bdl`);
        mainModel.bindANK1(parseBCK(rarc, `bck/wait1.bck`))
        mat4.translate(mainModel.modelMatrix, mainModel.modelMatrix, [0, 400, 0]); // Bump him up a bit so he's not halfway inside the floor
        const lanternModel = buildChildModel(rarc, `bdlm/bpw_kan1.bdl`);
        lanternModel.setParentJoint(mainModel, `j_bpw_item`);
        mat4.rotateZ(lanternModel.modelMatrix, lanternModel.modelMatrix, Math.PI);
        // TODO: add flame particle emitter to lantern
    });
    // Molgera
    else if (actor.name === 'Bwd') fetchArchive(`Bwd`).then((rarc) => {
        const mainModel = buildModel(rarc, `bdlm/bwd.bdl`);
        mainModel.bindTRK1(parseBRK(rarc, `brk/bwd.brk`), animFrame(0));

        // Add the parts of Molgera's tail. It's procedurally animated ingame, but for now just give it a static pose.
        let lastModel = mainModel;
        for (let i = 0; i < 20; i++) {
            let tailModel;
            if (i == 19) {
                tailModel = buildChildModel(rarc, `bdlm/bwd_shippob.bdl`);
                tailModel.bindTRK1(parseBRK(rarc, `brk/bwd_shippob.brk`), animFrame(0));
            } else {
                tailModel = buildChildModel(rarc, `bdlm/bwd_shippoa.bdl`);
                tailModel.bindTRK1(parseBRK(rarc, `brk/bwd_shippoa.brk`), animFrame(0));
            }
            if (i == 0) {
                tailModel.setParentJoint(lastModel, `hara`);
                mat4.rotateY(tailModel.modelMatrix, tailModel.modelMatrix, Math.PI * 1.5);
            } else {
                tailModel.setParentJoint(lastModel, `bwd`);
            }
            mat4.rotateX(tailModel.modelMatrix, tailModel.modelMatrix, -Math.PI / 40);
            mat4.translate(tailModel.modelMatrix, tailModel.modelMatrix, [0, 0, -200]);
            lastModel = tailModel;
        }
    });
    else if (actor.name === 'keeth') fetchArchive(`Ki`).then((rarc) => buildModel(rarc, `bdlm/ki.bdl`).bindANK1(parseBCK(rarc, `bck/wait1.bck`)));
    else if (actor.name === 'Fkeeth') fetchArchive(`Ki`).then((rarc) => buildModel(rarc, `bdlm/fk.bdl`).bindANK1(parseBCK(rarc, `bck/wait1.bck`)));
    else if (actor.name === 'Puti') fetchArchive(`Pt`).then((rarc) => buildModel(rarc, `bdlm/pt.bdl`).bindANK1(parseBCK(rarc, `bck/wait.bck`)));
    else if (actor.name === 'Rdead1' || actor.name === 'Rdead2') fetchArchive(`Rd`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/rd.bdl`);
        const idleAnimType = (actor.parameters & 0x00000001);
        if (idleAnimType == 0) {
            m.bindANK1(parseBCK(rarc, `bcks/tachip.bck`));
        } else {
            m.bindANK1(parseBCK(rarc, `bcks/suwarip.bck`));
        }
    });
    else if (actor.name === 'wiz_r') fetchArchive(`Wz`).then((rarc) => buildModel(rarc, `bdlm/wz.bdl`).bindANK1(parseBCK(rarc, `bck/s_demo_wait1.bck`)));
    else if (actor.name === 'gmos') fetchArchive(`Gm`).then((rarc) => buildModel(rarc, `bdlm/gm.bdl`).bindANK1(parseBCK(rarc, `bck/fly.bck`)));
    else if (actor.name === 'mo2') fetchArchive(`Mo2`).then((rarc) => buildModel(rarc, `bdlm/mo.bdl`).bindANK1(parseBCK(rarc, `bck/wait.bck`)));
    else if (actor.name === 'pow') fetchArchive(`Pw`).then(async (rarc) => {
        let color = (actor.parameters & 0x0000FE00) >> 9;
        if (color > 5)
            color = 0;

        const mainModel = buildModel(rarc, `bdlm/pw.bdl`);
        mainModel.bindANK1(parseBCK(rarc, `bck/wait1.bck`));
        mainModel.bindTPT1(parseBTP(rarc, `btp/irogae1.btp`), animFrame(color));

        const lanternRarc = await fetchArchive(`Kantera`);
        const lanternModel = buildChildModel(lanternRarc, `bmdm/mk_kantera.bmd`);
        lanternModel.bindTRK1(parseBRK(lanternRarc, `brk/mk_kantera.brk`));
        lanternModel.setParentJoint(mainModel, `j_pw_item_r1`);
        mat4.rotateX(lanternModel.modelMatrix, lanternModel.modelMatrix, Math.PI / 4);
    });
    else if (actor.name === 'Bb') fetchArchive(`Bb`).then((rarc) => buildModel(rarc, `bdlm/bb.bdl`).bindANK1(parseBCK(rarc, `bck/wait.bck`)));
    else if (actor.name === 'Bk') fetchArchive(`Bk`).then((rarc) => buildModel(rarc, `bdlm/bk.bdl`).bindANK1(parseBCK(rarc, `bck/bk_wait.bck`)));
    else if (actor.name === 'Oq') fetchArchive(`Oq`).then((rarc) => buildModel(rarc, `bmdm/oq.bmd`).bindANK1(parseBCK(rarc, `bck/nom_wait.bck`)));
    else if (actor.name === 'Oqw') fetchArchive(`Oq`).then((rarc) => buildModel(rarc, `bmdm/red_oq.bmd`).bindANK1(parseBCK(rarc, `bck/umi_new_wait.bck`)));
    else if (actor.name === 'Daiocta') fetchArchive(`Daiocta`).then((rarc) => buildModel(rarc, `bdlm/do_main1.bdl`).bindANK1(parseBCK(rarc, `bck/wait1.bck`)));
    else if (actor.name === 'Fmastr1' || name == 'Fmastr2') fetchArchive(`fm`).then((rarc) => { 
        buildModel(rarc, `bdl/fm.bdl`).bindANK1(parseBCK(rarc, `bcks/wait.bck`));
        const holeModel = buildModel(rarc, `bdlm/ypit00.bdl`);
        holeModel.bindTTK1(parseBTK(rarc, `btk/ypit00.btk`));
        // Move the hole just slightly up to prevent z-fighting with the ground.
        mat4.translate(holeModel.modelMatrix, holeModel.modelMatrix, [0, 0.1, 0]);
    });
    else if (actor.name === 'magtail') fetchArchive(`Mt`).then((rarc) => buildModel(rarc, `bdlm/mg_head.bdl`).bindANK1(parseBCK(rarc, `bck/wait1.bck`)));
    // Red and Blue Bubbles
    else if (name === 'bable') fetchArchive(`Bl`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bl.bdl`);

        const bubbleType = (actor.parameters & 0x000000FF);
        
        if (bubbleType == 0x80) {
            m.bindTTK1(parseBTK(rarc, 'btk/off.btk'));
        } else {
            m.bindANK1(parseBCK(rarc, 'bck/fly.bck'));

            // TODO: particles (0x8124 for red, 0x8123 for blue)
        }
    });
    else if (actor.name === 'nezumi') fetchArchive(`Nz`).then((rarc) => buildModel(rarc, `bdlm/nz.bdl`));
    else if (actor.name === 'moZOU') fetchArchive(`Mozo`).then((rarc) => buildModel(rarc, `bdlm/moz.bdl`));
    else if (actor.name === 'MtoriSU') fetchArchive(`MtoriSU`).then((rarc) => buildModel(rarc, `bdl/mtorisu.bdl`));
    // Darknut
    else if (actor.name === 'Tn') fetchArchive(`Tn`).then(async (rarc) => {
        const equipmentType = (actor.rot![0] & 0x00E0) >>> 5;
        const armorColor = (actor.parameters & 0x000000F0) >>> 4;
        
        const mainModel = buildModel(rarc, `bmdm/tn_main.bmd`);
        const mainAnim = parseBCK(rarc, `bck/aniou1.bck`);
        mainModel.bindTRK1(parseBRK(rarc, `brk/tn_main.brk`), animFrame(armorColor));

        const weaponRarc = await fetchArchive(`Tkwn`);
        const swordModel = buildChildModel(weaponRarc, `bdlc/tn_ken1.bdl`);
        swordModel.setParentJoint(mainModel, `j_tn_item_r1`);
        mat4.translate(swordModel.modelMatrix, swordModel.modelMatrix, [0, 0, 85]);
        
        const armorModel = buildChildModel(rarc, `bmdm/tn_yoroi1.bmd`);
        armorModel.setParentJoint(mainModel, `j_tn_mune1`);
        armorModel.bindTRK1(parseBRK(rarc, `brk/tn_yoroi1.brk`), animFrame(armorColor));
        // Translate to simulate the armor model being centered on the j_yoroi_main1 bone instead of tn_yoroi_allroot.
        mat4.translate(armorModel.modelMatrix, armorModel.modelMatrix, [-120, 0, 0]);
        mat4.rotateZ(armorModel.modelMatrix, armorModel.modelMatrix, Math.PI * 1.5);

        // Rotate both the ears by 180 degrees on all anim frames so they're hidden inside the head instead of poking out of the helmet.
        [30, 32].forEach((ear_joint_index) => {
            const earJointAnimEntry = mainAnim.jointAnimationEntries[ear_joint_index];
            for (let i = 0; i < earJointAnimEntry.rotationY.frames.length; i++) {
                const anim_frame = earJointAnimEntry.rotationY.frames[i];
                anim_frame.value += Math.PI;
            }
        });
        if (equipmentType >= 2) { // Has shield
            const shieldModel = buildChildModel(rarc, `bmdm/tn_tate1.bmd`);
            shieldModel.setParentJoint(mainModel, `j_tn_item_l1`);
            shieldModel.bindTRK1(parseBRK(rarc, `brk/tn_tate1.brk`), animFrame(armorColor));

            const shieldAnim = parseBCK(rarc, `bck/atate_on1.bck`);
            // If the Darknut has a shield, then the left arm joints (11-17) use anim atate_on1.bck, while the rest still use aniou1.bck.
            for (let joint_index = 11; joint_index < 18; joint_index++) {
                mainAnim.jointAnimationEntries[joint_index] = shieldAnim.jointAnimationEntries[joint_index];
            }
        }
        mainModel.bindANK1(mainAnim);

        let helmetModel;
        if (equipmentType == 1 || equipmentType == 3 || equipmentType >= 5) { // Has full face helmet
            helmetModel = buildChildModel(rarc, `bmdm/tn_kabuto2.bmd`);
            helmetModel.bindTRK1(parseBRK(rarc, `brk/tn_kabuto2.brk`), animFrame(armorColor));
        } else {
            helmetModel = buildChildModel(rarc, `bmdm/tn_kabuto1.bmd`);
            helmetModel.bindTRK1(parseBRK(rarc, `brk/tn_kabuto1.brk`), animFrame(armorColor));
        }
        helmetModel.setParentJoint(mainModel, `j_tn_atama1`);

        // TODO: The armor should look specular.

        if (equipmentType >= 5) { // Has a cape
            // TODO: Cape is procedurally animated. Also, the cape's textures are inside d_a_mant.rel.
        }
    });
    // Stalfos
    else if (actor.name === 'Stal') fetchArchive(`St`).then((rarc) => {
        const skeletonModel = buildModel(rarc, `bdlm/st.bdl`);
        skeletonModel.bindANK1(parseBCK(rarc, 'bck/wait.bck'));
        buildChildModel(rarc, `bdlm/st_hara.bdl`).setParentJoint(skeletonModel, `hara`);
        buildChildModel(rarc, `bdlm/st_mune.bdl`).setParentJoint(skeletonModel, `mune`);
        buildChildModel(rarc, `bdlm/st_katal.bdl`).setParentJoint(skeletonModel, `kataL`);
        buildChildModel(rarc, `bdlm/st_udel.bdl`).setParentJoint(skeletonModel, `udeL`);
        buildChildModel(rarc, `bdlm/st_handl.bdl`).setParentJoint(skeletonModel, `handL`);
        buildChildModel(rarc, `bdlm/st_yubi1l.bdl`).setParentJoint(skeletonModel, `yubi1L`);
        buildChildModel(rarc, `bdlm/st_yubi2l.bdl`).setParentJoint(skeletonModel, `yubi2L`);
        buildChildModel(rarc, `bdlm/st_katar.bdl`).setParentJoint(skeletonModel, `kataR`);
        buildChildModel(rarc, `bdlm/st_uder.bdl`).setParentJoint(skeletonModel, `udeR`);
        buildChildModel(rarc, `bdlm/st_handr.bdl`).setParentJoint(skeletonModel, `handR`);
        buildChildModel(rarc, `bdlm/st_buki.bdl`).setParentJoint(skeletonModel, `buki`);
        buildChildModel(rarc, `bdlm/st_yubi1r.bdl`).setParentJoint(skeletonModel, `yubi1R`);
        buildChildModel(rarc, `bdlm/st_yubi2r.bdl`).setParentJoint(skeletonModel, `yubi2R`);
        buildChildModel(rarc, `bdlm/st_kubi.bdl`).setParentJoint(skeletonModel, `kubi`);
        buildChildModel(rarc, `bdlm/st_head.bdl`).setParentJoint(skeletonModel, `head`);
        buildChildModel(rarc, `bdlm/st_ago.bdl`).setParentJoint(skeletonModel, `ago`);
        buildChildModel(rarc, `bdlm/st_hat.bdl`).setParentJoint(skeletonModel, `hat`);
        buildChildModel(rarc, `bdlm/st_kotuban.bdl`).setParentJoint(skeletonModel, `kotuban`);
        buildChildModel(rarc, `bdlm/st_momol.bdl`).setParentJoint(skeletonModel, `momoL`);
        buildChildModel(rarc, `bdlm/st_sunel.bdl`).setParentJoint(skeletonModel, `suneL`);
        buildChildModel(rarc, `bdlm/st_asil.bdl`).setParentJoint(skeletonModel, `asiL`);
        buildChildModel(rarc, `bdlm/st_momor.bdl`).setParentJoint(skeletonModel, `momoR`);
        buildChildModel(rarc, `bdlm/st_suner.bdl`).setParentJoint(skeletonModel, `suneR`);
        buildChildModel(rarc, `bdlm/st_asir.bdl`).setParentJoint(skeletonModel, `asiR`);
        // Set a fake bbox for the main invisible skeleton model so it doesn't get culled when the camera isn't right on top of it.
        skeletonModel.modelInstance.modelData.bbox = new AABB(-80, -80, -80, 80, 80, 80);
    });
    // Peahats and Seahats
    else if (actor.name === 'p_hat') {
        const type = (actor.parameters & 0x000000FF);
        if (type == 1) {
            fetchArchive(`Sh`).then((rarc) => {
                const mainModel = buildModel(rarc, `bmdm/shb.bmd`);
                mainModel.bindANK1(parseBCK(rarc, 'bck/bfly.bck'));
                mat4.scale(mainModel.modelMatrix, mainModel.modelMatrix, [9, 9, 9]);
                const propellerModel = buildModel(rarc, `bmdm/shp.bmd`);
                propellerModel.bindANK1(parseBCK(rarc, 'bck/pfly.bck'));
                mat4.scale(propellerModel.modelMatrix, propellerModel.modelMatrix, [9, 9, 9]);
                mat4.translate(propellerModel.modelMatrix, propellerModel.modelMatrix, [0, 50, 0]); // Estimated Y offset
            });
        } else {
            fetchArchive(`Ph`).then((rarc) => {
                const mainModel = buildModel(rarc, `bdlm/phb.bdl`);
                mainModel.bindANK1(parseBCK(rarc, 'bck/bfly.bck'));
                const propellerModel = buildModel(rarc, `bdlm/php.bdl`);
                propellerModel.bindANK1(parseBCK(rarc, 'bck/pfly.bck'));
                mat4.translate(propellerModel.modelMatrix, propellerModel.modelMatrix, [0, 50, 0]); // Estimated Y offset
            });
        }
    }
    else if (actor.name === 'bbaba') fetchArchive(`Bo`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/bo_sita1.bdl`);
        // TODO(jstpierre): animation?
    });
    // ChuChus
    else if (actor.name === 'c_green' || actor.name === 'c_red' || actor.name === 'c_blue' || name == 'c_black' || name == 'c_kiiro') fetchArchive(`Cc`).then((rarc) => {
        const cc = buildModel(rarc, `bmdm/cc.bmd`);
        cc.bindANK1(parseBCK(rarc, `bck/tachi_walk.bck`));

        const chuchuType = (actor.parameters & 0x0000FF00) >>> 8;
        let frameNum;
        switch (chuchuType) {
        case 0:
        case 10:
            // Green
            frameNum = 0;
            break;
        case 1:
        case 11:
        case 15:
            // Red
            frameNum = 1;
            break;
        case 2:
        case 12:
            // Blue
            frameNum = 2;
            break;
        case 3:
        case 13:
            // Dark
            frameNum = 3;
            break;
        case 4:
        case 14:
            // Yellow
            frameNum = 4;
            break;
        default:
            frameNum = 0;
            break;
        }
        cc.bindTRK1(parseBRK(rarc, `brk/cc.brk`), animFrame(frameNum));
    });
    // Beedle's Shop Ship (in Tip Top Shape)
    else if (actor.name === 'ikada_h') fetchArchive(`IkadaH`).then((rarc) => buildModel(rarc, `bdl/vtsp.bdl`));
    // Helmeted Beedle's Shop Ship
    else if (actor.name === 'ikada_u') fetchArchive(`IkadaH`).then((rarc) => buildModel(rarc, `bdl/vtsp2.bdl`));
    // The Great Sea
    else if (actor.name === 'Svsp') fetchArchive(`IkadaH`).then((rarc) => buildModel(rarc, `bdl/vsvsp.bdl`));
    else if (actor.name === 'Vtil1') fetchArchive(`Vtil`).then((rarc) => buildModel(rarc, `bdl/vtil1.bdl`));
    else if (actor.name === 'Vtil2') fetchArchive(`Vtil`).then((rarc) => buildModel(rarc, `bdl/vtil2.bdl`));
    else if (actor.name === 'Vtil3') fetchArchive(`Vtil`).then((rarc) => buildModel(rarc, `bdl/vtil3.bdl`));
    else if (actor.name === 'Vtil4') fetchArchive(`Vtil`).then((rarc) => buildModel(rarc, `bdl/vtil4.bdl`));
    else if (actor.name === 'Vtil5') fetchArchive(`Vtil`).then((rarc) => buildModel(rarc, `bdl/vtil5.bdl`));
    else if (actor.name === 'Ekskz') fetchArchive(`Ekskz`).then((rarc) => {
        buildModel(rarc, `bdl/ekskz.bdl`);
        const yocwd00 = buildModel(rarc, `bdlm/yocwd00.bdl`);
        yocwd00.bindANK1(parseBCK(rarc, `bck/yocwd00.bck`));
        yocwd00.bindTRK1(parseBRK(rarc, `brk/yocwd00.brk`));
        yocwd00.bindTTK1(parseBTK(rarc, `btk/yocwd00.btk`));
    });
    else if (actor.name === 'Ocanon') fetchArchive(`WallBom`).then((rarc) => buildModel(rarc, `bdl/wallbom.bdl`));
    else if (actor.name === 'Canon') fetchArchive(`Bomber`).then((rarc) => buildModel(rarc, `bdl/vcank.bdl`));
    else if (actor.name === 'Aygr') fetchArchive(`Aygr`).then((rarc) => {
        buildModel(rarc, `bdl/aygr.bdl`);
        buildModel(rarc, `bdl/aygrh.bdl`);
    });
    else if (actor.name === 'Ayush') fetchArchive(`Ayush`).then((rarc) => buildModel(rarc, `bdlm/ayush.bdl`).bindTTK1(parseBTK(rarc, `btk/ayush.btk`)));
    else if (actor.name === 'Ikada') fetchArchive(`IkadaH`).then((rarc) => buildModel(rarc, `bdl/vikae.bdl`));
    else if (actor.name === 'ikadaS') fetchArchive(`IkadaH`).then((rarc) => buildModel(rarc, `bdl/vikah.bdl`));
    else if (actor.name === 'Oship') fetchArchive(`Oship`).then((rarc) => buildModel(rarc, `bdl/vbtsp.bdl`));
    else if (actor.name === 'GiceL') fetchArchive(`GiceL`).then((rarc) => {
        const m = buildModel(rarc, `bdli/gicel00.bdl`);
        m.bindTTK1(parseBTK(rarc, `btk/gicel00_01.btk`));
        m.bindTRK1(parseBRK(rarc, `brk/gicel00.brk`));
    });
    else if (actor.name === 'Qdghd') fetchArchive(`Qdghd`).then((rarc) => buildModel(rarc, `bdl/qdghd.bdl`));
    else if (actor.name === 'Qtkhd') fetchArchive(`Qtkhd`).then((rarc) => buildModel(rarc, `bdl/qtkhd.bdl`));
    else if (actor.name === 'Ylsic') fetchArchive(`Ylsic`).then((rarc) => buildModel(rarc, `bdl/ylsic.bdl`));
    else if (actor.name === 'Yllic') fetchArchive(`Yllic`).then((rarc) => buildModel(rarc, `bdl/yllic.bdl`));
    else if (actor.name === 'Ykzyg') fetchArchive(`Ykzyg`).then((rarc) => {
        buildModel(rarc, `bdlm/qkzyg.bdl`).bindTTK1(parseBTK(rarc, `btk/qkzyg.btk`));
        // TODO(jstpierre): ymnkz00
    });
    else if (actor.name === 'Ygush00' || actor.name === 'Ygush01' || actor.name === 'Ygush02') fetchArchive(`Ygush00`).then((rarc) => buildModel(rarc, `bdlm/ygush00.bdl`).bindTTK1(parseBTK(rarc, `btk/ygush00.btk`)));
    else if (actor.name === 'Yboil00') fetchArchive(`Yboil`).then((rarc) => buildModel(rarc, `bdlm/yboil00.bdl`).bindTTK1(parseBTK(rarc, `btk/yboil00.btk`)));
    else if (actor.name === 'Ygstp00') fetchArchive(`Ygush00`).then((rarc) => buildModel(rarc, `bdlm/ygstp00.bdl`).bindTTK1(parseBTK(rarc, `btk/ygstp00.btk`)));
    else if (actor.name === 'Ytrnd00') fetchArchive(`Trnd`).then((rarc) => {
        buildModel(rarc, `bdlm/ytrnd00.bdl`).bindTTK1(parseBTK(rarc, `btk/ytrnd00.btk`));
        buildModel(rarc, `bdlm/ywuwt00.bdl`).bindTTK1(parseBTK(rarc, `btk/ywuwt00.btk`));
    });
    else if (actor.name === 'Sarace') fetchArchive(`Sarace`).then((rarc) => buildModel(rarc, `bdl/sa.bdl`));
    else if (actor.name === 'Ocloud') fetchArchive(`BVkumo`).then((rarc) => buildModel(rarc, `bdlm/bvkumo.bdl`).bindTTK1(parseBTK(rarc, `btk/bvkumo.btk`)));
    // Triangle Island Statue: TODO(jstpierre): finish the submodels
    else if (actor.name === 'Doguu') fetchArchive(`Doguu`).then((rarc) => {
        const which = actor.parameters & 0xFF;
        const bmtPaths = ['bmt/vgsmd.bmt', 'bmt/vgsmf.bmt', 'bmt/vgsmn.bmt'];
        const brkPaths = ['brk/vgsmd.brk', 'brk/vgsmf.brk', 'brk/vgsmn.brk'];
        const m = buildModelBMT(rarc, `bdlm/vgsma.bdl`, bmtPaths[which]);
        m.bindTRK1(parseBRK(rarc, brkPaths[which]));
    });
    // Outset Island
    else if (actor.name === 'Lamp') fetchArchive(`Lamp`).then((rarc) => {
        const m = buildModel(rarc, `bmd/lamp_00.bmd`);
        const scale = 0.5;
        mat4.scale(m.modelMatrix, m.modelMatrix, [scale, scale, scale]);
    });
    else if (actor.name === 'MKoppu') fetchArchive(`Mshokki`).then((rarc) => buildModel(rarc, `bdl/koppu.bdl`));
    else if (actor.name === 'MOsara') fetchArchive(`Mshokki`).then((rarc) => buildModel(rarc, `bdl/osara.bdl`));
    else if (actor.name === 'MPot') fetchArchive(`Mshokki`).then((rarc) => buildModel(rarc, `bdl/pot.bdl`));
    else if (actor.name === 'Branch') fetchArchive(`Kwood_00`).then((rarc) => buildModel(rarc, `bmdc/ws.bmd`));
    else if (actor.name === 'Otble') fetchArchive(`Okmono`).then((rarc) => buildModel(rarc, `bdl/otable.bdl`));
    else if (actor.name === 'OtbleL') fetchArchive(`Okmono`).then((rarc) => buildModel(rarc, `bdl/otablel.bdl`));
    else if (actor.name === 'AjavW') {
        fetchArchive(`AjavW`).then(rarc => {
            const m = buildModel(rarc, `bdlm/ajavw.bdl`);
            m.lightTevColorType = LightType.BG1;
            m.bindTTK1(parseBTK(rarc, `btk/ajavw.btk`));
        });
    } else if (actor.name === 'Vdora') fetchArchive(`Vdora`).then((rarc) => buildModel(rarc, `bdl/vdora.bdl`));
    // Windfall Island
    else if (actor.name === 'Roten2') fetchArchive(`Roten`).then((rarc) => buildModel(rarc, `bdl/roten02.bdl`));
    else if (actor.name === 'Roten3') fetchArchive(`Roten`).then((rarc) => buildModel(rarc, `bdl/roten03.bdl`));
    else if (actor.name === 'Roten4') fetchArchive(`Roten`).then((rarc) => buildModel(rarc, `bdl/roten04.bdl`));
    else if (actor.name === 'Fdai') fetchArchive(`Fdai`).then((rarc) => buildModel(rarc, `bdl/fdai.bdl`));
    else if (actor.name === 'GBoard') fetchArchive(`Kaisen_e`).then((rarc) => buildModel(rarc, `bdl/akbod.bdl`));
    else if (actor.name === 'Nzfall') fetchArchive(`Pfall`).then((rarc) => buildModel(rarc, `bdl/nz.bdl`).bindANK1(parseBCK(rarc, `bcks/nz_wait.bck`)));
    else if (actor.name === 'Paper') fetchArchive(`Opaper`).then((rarc) => {
        const m = buildModel(rarc, `bdl/opaper.bdl`);
        mat4.rotateX(m.modelMatrix, m.modelMatrix, Math.PI / 2);
    });
    else if (actor.name === 'Cafelmp') fetchArchive(`Cafelmp`).then((rarc) => buildModel(rarc, `bdl/ylamp.bdl`));
    else if (actor.name === 'Pbka') fetchArchive(`Pbka`).then((rarc) => buildModel(rarc, `bdl/pbka.bdl`));
    else if (actor.name === 'Plant') fetchArchive(`Plant`).then((rarc) => buildModel(rarc, `bdl/yrmwd.bdl`));
    else if (actor.name === 'Table') fetchArchive(`Table`).then((rarc) => buildModel(rarc, `bdl/ytble.bdl`));
    else if (actor.name === 'Ppos') fetchArchive(`Ppos`).then((rarc) => buildModel(rarc, `bdl/ppos.bdl`));
    else if (actor.name === 'Rflw') fetchArchive(`Rflw`).then((rarc) => buildModel(rarc, `bdl/phana.bdl`));
    else if (actor.name === 'Skanran') fetchArchive(`Skanran`).then((rarc) => buildModel(rarc, `bdl/skanran.bdl`));
    else if (actor.name === 'Stoudai') fetchArchive(`Skanran`).then((rarc) => buildModel(rarc, `bdl/stoudai.bdl`));
    // Pirate stuff
    else if (actor.name === 'Pirates') fetchArchive(`Kaizokusen`).then((rarc) => buildModel(rarc, `bdl/oba_kaizoku_a.bdl`));
    else if (actor.name === 'Ashut') fetchArchive(`Ashut`).then((rarc) => buildModel(rarc, `bdl/ashut.bdl`));
    else if (actor.name === 'Ospbox') fetchArchive(`Ospbox`).then((rarc) => buildModel(rarc, `bdl/ospbox.bdl`));
    // The platforms in the pirate ship which go up and down.
    else if (actor.name === 'Hlift') fetchArchive(`Hlift`).then((rarc) => {
        const m = buildModel(rarc, `bdl/hlift.bdl`);
        m.modelMatrix[13] += 350;
    });
    else if (actor.name === 'Hliftb') fetchArchive(`Hlift`).then((rarc) => {
        const m = buildModel(rarc, `bdl/hliftb.bdl`);
        m.modelMatrix[13] += 300;
    });
    // Beedle's Ship
    else if (actor.name === 'Ptco') fetchArchive(`Ptc`).then((rarc) => buildModel(rarc, `bdl/ptco.bdl`));
    else if (actor.name === 'Ptcu') fetchArchive(`Ptc`).then((rarc) => buildModel(rarc, `bdl/ptcu.bdl`));
    // Forsaken Fortress
    else if (actor.name === 'Gaship1') fetchArchive(`GaShip`).then((rarc) => buildModel(rarc, `bdl/gaship.bdl`));
    else if (actor.name === 'Gaship2') fetchArchive(`YakeRom`).then((rarc) => buildModel(rarc, `bdl/yakerom.bdl`));
    else if (actor.name === 'dmgroom') fetchArchive(`dmgroom`).then((rarc) => buildModel(rarc, `bdlm/dmgroom.bdl`));
    else if (actor.name === 'nezuana') fetchArchive(`Nzg`).then((rarc) => buildModel(rarc, `bdl/kana_00.bdl`));
    else if (actor.name === 'Shmrgrd') fetchArchive(`Shmrgrd`).then((rarc) => buildModel(rarc, `bdl/shmrgrd.bdl`));
    else if (actor.name === 'ATdoor') fetchArchive(`Atdoor`).then((rarc) => buildModel(rarc, `bdl/sdoor01.bdl`));
    else if (actor.name === 'Search') fetchArchive(`Search`).then((rarc) => buildModel(rarc, `bdl/s_search.bdl`));
    else if (actor.name === 'Ikari') fetchArchive(`Ikari`).then((rarc) => buildModel(rarc, `bdl/s_ikari2.bdl`));
    else if (actor.name === 'SMtoge') fetchArchive(`Mtoge`).then((rarc) => buildModel(rarc, `bmd/s_mtoge.bmd`));
    // Dragon Roost Island
    else if (actor.name === 'BFlower' || actor.name === 'VbakH') fetchArchive(`VbakH`).then((rarc) => {
        buildModel(rarc, `bdlm/vbakh.bdl`);
        buildModel(rarc, `bdlm/vbakm.bdl`);
    });
    else if (actor.name === 'Rcloud') fetchArchive(`BVkumo`).then((rarc) => buildModel(rarc, `bdlm/bvkumo.bdl`).bindTTK1(parseBTK(rarc, `btk/bvkumo.btk`)))
    else if (actor.name === 'TrFlag') fetchArchive(`Trflag`).then((rarc) => buildModel(rarc, `bdl/ethata.bdl`));
    else if (actor.name === 'Piwa') fetchArchive(`Piwa`).then((rarc) => buildModel(rarc, `bdl/piwa.bdl`));
    else if (actor.name === 'Gryw00') fetchArchive(`Gryw00`).then((rarc) => buildModel(rarc, `bdlm/gryw00.bdl`));
    else if (actor.name === 'Eayogn') fetchArchive(`Eayogn`).then((rarc) => buildModel(rarc, `bdl/eayogn.bdl`));
    else if (actor.name === 'Mswing') fetchArchive(`Msw`).then((rarc) => buildModel(rarc, `bdl/mswng.bdl`));
    else if (actor.name === 'Dsaku') fetchArchive(`Knsak_00`).then((rarc) => buildModel(rarc, `bdl/knsak_00.bdl`));
    else if (actor.name === 'Ksaku') fetchArchive(`Ksaku_00`).then((rarc) => buildModel(rarc, `bdl/ksaku_00.bdl`));
    else if (actor.name === 'Mflft') fetchArchive(`Mflft`).then((rarc) => buildModel(rarc, `bdl/mflft.bdl`));
    else if (actor.name === 'Yfire00') fetchArchive(`Yfire_00`).then((rarc) => {
        buildModel(rarc, `bmdm/yfire_00.bmd`);
        buildModel(rarc, `bmdm/yfirb_00.bmd`).bindTTK1(parseBTK(rarc, `btk/yfirb_00.btk`));
    });
    else if (actor.name === 'Zenfire') {
        // Create particle emitters
        const burningGroundEmitter = createEmitter(renderer, 0x461);
        const ringOfFlamesEmitter = createEmitter(renderer, 0x462);
        setModelMatrix(scratchMat4a);
        vec3.set(scratchVec3a, 0, 0, 0);
        vec3.transformMat4(scratchVec3a, scratchVec3a, scratchMat4a);
        vec3.copy(burningGroundEmitter.globalTranslation, scratchVec3a);
        vec3.copy(ringOfFlamesEmitter.globalTranslation, scratchVec3a);
    }
    // Forest Haven
    else if (actor.name === 'Ohatch') fetchArchive(`Ohatch`).then((rarc) => buildModel(rarc, `bdl/ohatch.bdl`));
    else if (actor.name === 'Ojtree') fetchArchive(`Ojtree`).then((rarc) => buildModel(rarc, `bdl/ojtree.bdl`));
    else if (actor.name === 'Olift') fetchArchive(`Olift`).then((rarc) => buildModel(rarc, `bdl/olift.bdl`));
    else if (actor.name === 'itemDek') fetchArchive(`Deku`).then((rarc) => buildModel(rarc, `bdlm/vlfdm.bdl`));
    else if (actor.name === 'ho') fetchArchive(`Ff`).then((rarc) => {
        const fireflyModel = buildModel(rarc, `bmd/ho.bmd`);
        fireflyModel.bindTRK1(parseBRK(rarc, `brk/ho.brk`));
        const glowModel = buildChildModel(rarc, `bmd/hop.bmd`);
        glowModel.setParentJoint(fireflyModel, `ho_B`);
        glowModel.bindTRK1(parseBRK(rarc, `brk/hop.brk`));
        mat4.translate(fireflyModel.modelMatrix, fireflyModel.modelMatrix, [0, 50, 0]);
    });
    else if (actor.name === 'jbaba') fetchArchive(`Jbo`).then((rarc) => buildModel(rarc, `bmdm/jh.bmd`));
    else if (actor.name === 'VigaH') fetchArchive(`VigaH`).then((rarc) => buildModel(rarc, `bdl/vigah.bdl`));
    else if (actor.name === 'Ss') fetchArchive(`Ss`).then((rarc) => buildModel(rarc, `bdl/sw.bdl`));
    else if (actor.name === 'Sss') fetchArchive(`Sss`).then((rarc) => buildModel(rarc, `bmd/sss_hand.bmd`));
    else if (actor.name === 'Turu') fetchArchive(`Sk`).then((rarc) => buildModel(rarc, `bdl/turu_00.bdl`));
    else if (actor.name === 's_turu') fetchArchive(`Ssk`).then((rarc) => buildModel(rarc, `bdl/turu_02.bdl`));
    else if (actor.name === 'Turu2') fetchArchive(`Sk2`).then((rarc) => buildModel(rarc, `bdlm/ksylf_00.bdl`));
    else if (actor.name === 'Turu3') fetchArchive(`Sk2`).then((rarc) => buildModel(rarc, `bdlm/ksylf_01.bdl`));
    else if (actor.name === 'Kita') fetchArchive(`kita`).then((rarc) => buildModel(rarc, `bdl/vhlif_00.bdl`));
    else if (actor.name === 'Klft') fetchArchive(`Klft`).then((rarc) => buildModel(rarc, `bdlm/lift_00.bdl`));
    else if (actor.name === 'Kokiie') fetchArchive(`Kokiie`).then((rarc) => buildModel(rarc, `bdl/koki_00.bdl`));
    else if (actor.name === 'Vpbot') fetchArchive(`Vpbot_00`).then((rarc) => buildModel(rarc, `bdl/vpbot_00.bdl`));
    else if (actor.name === 'Vochi') fetchArchive(`Vochi`).then((rarc) => buildModel(rarc, `bdl/vochi.bdl`));
    else if (actor.name === 'Kanat') fetchArchive(`Kanat`).then((rarc) => buildModel(rarc, `bdl/kanat.bdl`));
    else if (actor.name === 'Kryu00') fetchArchive(`Kryu`).then((rarc) => buildModel(rarc, `bdl/ryu_00.bdl`));
    // Tower of the Gods
    else if (actor.name === 'X_tower') fetchArchive(`X_tower`).then((rarc) => buildModel(rarc, `bdl/x_tower.bdl`));
    else if (actor.name === 'Wall') fetchArchive(`Hbw1`).then((rarc) => buildModel(rarc, `bdl/hbw1.bdl`));
    else if (actor.name === 'Hmon1d') fetchArchive(`Hseki`).then((rarc) => buildModel(rarc, `bdlm/hmon1.bdl`).bindTRK1(parseBRK(rarc, `brk/hmon1.brk`)));
    else if (actor.name === 'Hmon2d') fetchArchive(`Hseki`).then((rarc) => buildModel(rarc, `bdlm/hmon2.bdl`).bindTRK1(parseBRK(rarc, `brk/hmon2.brk`)));
    else if (actor.name === 'Hmos1') fetchArchive(`Hmos`).then((rarc) => buildModel(rarc, `bdl/hmos1.bdl`));
    else if (actor.name === 'Hmos2') fetchArchive(`Hmos`).then((rarc) => buildModel(rarc, `bdl/hmos2.bdl`));
    else if (actor.name === 'Hmos3') fetchArchive(`Hmos`).then((rarc) => buildModel(rarc, `bdl/hmos3.bdl`));
    else if (actor.name === 'amos') fetchArchive(`Am`).then((rarc) => buildModel(rarc, `bdl/am.bdl`));
    else if (actor.name === 'amos2') fetchArchive(`Am2`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/am2.bdl`);
        m.bindANK1(parseBCK(rarc, `bck/wait.bck`));
        m.bindTTK1(parseBTK(rarc, `btk/am2.btk`));
        m.bindTRK1(parseBRK(rarc, `brk/am2.brk`));
    });
    else if (actor.name === 'Hha') fetchArchive(`Hha`).then((rarc) => {
        buildModel(rarc, `bdlm/hha1.bdl`);
        buildModel(rarc, `bdlm/hha2.bdl`);
    });
    else if (actor.name === 'Gkai00') fetchArchive(`Gkai00`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/gkai00.bdl`);
        m.bindANK1(parseBCK(rarc, `bck/gkai00.bck`));
        m.bindTRK1(parseBRK(rarc, `brk/gkai00.brk`));
        m.bindTTK1(parseBTK(rarc, `btk/gkai00.btk`));
    });
    else if (actor.name === 'Gbrg00') fetchArchive(`Gbrg00`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/gbrg00.bdl`);
        m.bindTRK1(parseBRK(rarc, `brk/gbrg00.brk`));
        m.bindTTK1(parseBTK(rarc, `btk/gbrg00.btk`));
    });
    else if (actor.name === 'Humi0z') fetchArchive(`Humi`).then((rarc) => buildModel(rarc, `bdlm/humi0.bdl`).bindTTK1(parseBTK(rarc, `btk/humi0.btk`)));
    else if (actor.name === 'Humi2z') fetchArchive(`Humi`).then((rarc) => buildModel(rarc, `bdlm/humi2.bdl`).bindTTK1(parseBTK(rarc, `btk/humi2.btk`)));
    else if (actor.name === 'Humi3z') fetchArchive(`Humi`).then((rarc) => buildModel(rarc, `bdlm/humi3.bdl`).bindTTK1(parseBTK(rarc, `btk/humi3.btk`)));
    else if (actor.name === 'Humi4z') fetchArchive(`Humi`).then((rarc) => buildModel(rarc, `bdlm/humi4.bdl`).bindTTK1(parseBTK(rarc, `btk/humi4.btk`)));
    else if (actor.name === 'Humi5z') fetchArchive(`Humi`).then((rarc) => buildModel(rarc, `bdlm/humi5.bdl`).bindTTK1(parseBTK(rarc, `btk/humi5.btk`)));
    else if (actor.name === 'Htetu1') fetchArchive(`Htetu1`).then((rarc) => buildModel(rarc, `bdl/htetu1.bdl`));
    else if (actor.name === 'Htobi1') fetchArchive(`Htobi1`).then((rarc) => buildModel(rarc, `bdl/htobi1.bdl`));
    else if (actor.name === 'Hmlif') fetchArchive(`Hmlif`).then((rarc) => buildModel(rarc, `bdlm/hmlif.bdl`));
    else if (actor.name === 'Hdai1') fetchArchive(`Hdai1`).then((rarc) => buildModel(rarc, `bdlm/hdai1.bdl`));
    else if (actor.name === 'Hdai2') fetchArchive(`Hdai1`).then((rarc) => buildModel(rarc, `bdlm/hdai1.bdl`));
    else if (actor.name === 'Hdai3') fetchArchive(`Hdai1`).then((rarc) => buildModel(rarc, `bdlm/hdai1.bdl`));
    else if (actor.name === 'Hsh') fetchArchive(`Hsehi1`).then((rarc) => buildModel(rarc, `bdl/hsehi1.bdl`));
    else if (actor.name === 'Hsh2') fetchArchive(`Hsehi2`).then((rarc) => buildModel(rarc, `bdl/hsehi2.bdl`));
    else if (actor.name === 'Hyuf1') fetchArchive(`Hyuf1`).then((rarc) => buildModel(rarc, `bdlm/hyuf1.bdl`));
    else if (actor.name === 'Hyuf2') fetchArchive(`Hyuf2`).then((rarc) => buildModel(rarc, `bdlm/hyuf2.bdl`));
    else if (actor.name === 'Blift') fetchArchive(`Hten1`).then((rarc) => buildModel(rarc, `bdl/hten1.bdl`));
    else if (actor.name === 'Hcbh') fetchArchive(`Hcbh`).then((rarc) => {
        buildModel(rarc, `bdl/hcbh1a.bdl`);
        buildModel(rarc, `bdl/hcbh1b.bdl`);
        buildModel(rarc, `bdl/hcbh1c.bdl`);
        buildModel(rarc, `bdl/hcbh1d.bdl`);
        buildModel(rarc, `bdl/hcbh2.bdl`);
    });
    else if (actor.name === 'Hfbot1B') fetchArchive(`Hfbot`).then((rarc) => buildModel(rarc, `bdlm/hfbot1.bdl`).bindTRK1(parseBRK(rarc, `brk/hfbot1.brk`)));
    else if (actor.name === 'Hfbot1C') fetchArchive(`Hfbot`).then((rarc) => buildModel(rarc, `bdlm/hfbot1.bdl`).bindTRK1(parseBRK(rarc, `brk/hfbot1.brk`)));
    else if (actor.name === 'Hys') fetchArchive(`Hys`).then((rarc) => buildModel(rarc, `bdlm/hys.bdl`));
    else if (actor.name === 'Hys2') fetchArchive(`Hys`).then((rarc) => buildModel(rarc, `bdlm/hys.bdl`));
    else if (actor.name === 'Ywarp00') fetchArchive(`Ywarp00`).then((rarc) => {
        const m = buildModel(rarc, `bmdm/ywarp00.bmd`);
        m.bindANK1(parseBCK(rarc, `bck/ywarp00.bck`));
        m.bindTRK1(parseBRK(rarc, `brk/ywarp00.brk`));
    });
    // Hyrule.
    else if (actor.name === 'YLzou') fetchArchive(`YLzou`).then((rarc) => buildModel(rarc, `bdl/ylzou.bdl`));
    else if (actor.name === 'MtryB') fetchArchive(`MtryB`).then((rarc) => buildModel(rarc, `bdl/mtryb.bdl`));
    else if (actor.name === 'zouK' || actor.name === 'zouK1' || actor.name === 'zouK2' || actor.name === 'zouK3' || actor.name === 'zouK4') fetchArchive(`VzouK`).then((rarc) => buildModel(rarc, `bdl/vzouk.bdl`));
    else if (actor.name === 'VmsDZ') fetchArchive(`VmsDZ`).then((rarc) => buildModel(rarc, `bdl/vmsdz.bdl`));
    else if (actor.name === 'VmsMS') fetchArchive(`VmsMS`).then((rarc) => buildModel(rarc, `bdl/vmsms.bdl`));
    else if (actor.name === 'Yswdr00') fetchArchive(`Yswdr00`).then((rarc) => buildModel(rarc, `bdlm/yswdr00.bdl`).bindTTK1(parseBTK(rarc, `btk/yswdr00.btk`)));
    // Earth Temple.
    else if (actor.name === 'MhmrSW0') fetchArchive(`MhmrSW`).then((rarc) => buildModel(rarc, `bdl/mhmrsw.bdl`));
    else if (actor.name === 'Vds') fetchArchive(`Vds`).then((rarc) => {
        const rightHalfModel = buildModel(rarc, `bdlm/vdswt0.bdl`);
        rightHalfModel.bindANK1(parseBCK(rarc, `bck/vdswt0.bck`));
        rightHalfModel.bindTRK1(parseBRK(rarc, `brk/vdswt0.brk`));
        const leftHalfModel = buildModel(rarc, `bdlm/vdswt1.bdl`);
        leftHalfModel.bindANK1(parseBCK(rarc, `bck/vdswt1.bck`));
        leftHalfModel.bindTRK1(parseBRK(rarc, `brk/vdswt1.brk`));
    });
    else if (actor.name === 'MsuSWB') fetchArchive(`Mmirror`).then((rarc) => {
        const m = buildModel(rarc, `bdlm/msusw.bdl`);
        m.bindANK1(parseBCK(rarc, `bck/msusw.bck`));
        m.bindTTK1(parseBTK(rarc, `btk/msusw.btk`));
    });
    // Nintendo Gallery
    else if (actor.name === 'Figure') {
        fetchArchive(`Figure`).then((rarc) => buildModel(rarc, `bdlm/vf_bs.bdl`))
        const figureId = actor.parameters & 0x000000FF;
        const baseFilename = `vf_${leftPad(''+figureId, 3)}`;
        const base = `bdl/${baseFilename}`;

        // Outset Island
        if (figureId >= 0x00 && figureId <= 0x0D) fetchArchive(`Figure0`).then((rarc) => {
            buildModel(rarc, `${base}.bdl`).modelMatrix[13] += 100;
        });
        // Windfall Island
        else if (figureId >= 0x0E && figureId <= 0x28) fetchArchive(`Figure1`).then((rarc) => {
            if (figureId === 16 || figureId === 18) {
                buildModel(rarc, `${base}b.bdl`).modelMatrix[13] += 100;
            } else {
                buildModel(rarc, `${base}.bdl`).modelMatrix[13] += 100;
            }
        });
        else if (figureId >= 0x29 && figureId <= 0x40) fetchArchive(`Figure2`).then((rarc) => {
            // Nintendo is REALLY cool.
            if (figureId === 61) {
                buildModel(rarc, `bdlm/${baseFilename}.bdl`).modelMatrix[13] += 100;
            } else {
                buildModel(rarc, `${base}.bdl`).modelMatrix[13] += 100;
            }

            // TODO(jstpierre): What are Figure2a/b for? 
            // fetchArchive(`Figure2a`).then((rarc) => console.log("2a", rarc));
            // fetchArchive(`Figure2b`).then((rarc) => console.log("2b", rarc));
        });
        // Dragon Roost Island
        else if (figureId >= 0x41 && figureId <= 0x52) fetchArchive(`Figure3`).then((rarc) => {
            buildModel(rarc, `${base}.bdl`).modelMatrix[13] += 100;
        });
        // Forest Haven
        else if (figureId >= 0x53 && figureId <= 0x60) fetchArchive(`Figure4`).then((rarc) => {
            buildModel(rarc, `${base}.bdl`).modelMatrix[13] += 100;
        });
        // Secret Cavern
        else if (figureId >= 0x61 && figureId <= 0x73) fetchArchive(`Figure5`).then((rarc) => {
            buildModel(rarc, `${base}.bdl`).modelMatrix[13] += 100;
        });
        // Forsaken Fortress
        else if (figureId >= 0x74 && figureId <= 0xFF) fetchArchive(`Figure6`).then((rarc) => {
            buildModel(rarc, `${base}.bdl`).modelMatrix[13] += 100;
        });
    } else if (actor.name === 'KNOB00') {
        // Doors: TODO(jstpierre)
    } else if (actor.name === 'Salvage' || actor.name === 'Salvag2' || actor.name === 'SalvagE' || actor.name === 'SalvagN' || actor.name === 'SalvFM') {
        // Under-water treasure points. Perhaps spawn at some point?
    } else if (actor.name === 'woodb' || actor.name === 'woodbx') {
        // Bushes. Procedurally generated by the engine.
    } else if (actor.name === 'RopeR') {
        // Rope. Procedurally generated by the engine.
    } else if (actor.name === 'bridge') {
        // Bridges. Procedurally generated by the engine.
    } else if (actor.name === 'GyCtrl' || actor.name === 'GyCtrlB') {
        // Gyorg spawners.
    } else if (actor.name === 'agbTBOX' || actor.name === 'agbMARK' || actor.name === 'agbF' || actor.name === 'agbA' || actor.name === 'agbAT' || actor.name === 'agbA2' || actor.name === 'agbR' || actor.name === 'agbB' || actor.name === 'agbFA' || actor.name === 'agbCSW') {
        // Markers for Tingle Tuner
    } else if (actor.name === 'AND_SW0' || actor.name === 'AND_SW1' || actor.name === 'AND_SW2' || actor.name === 'SW_HIT0' || actor.name === 'ALLdie' || actor.name === 'SW_C00') {
        // Logic flags used for gameplay, not spawnable objects.
    } else if (actor.name === 'SwSlvg') {
        // SWitch SaLVaGe?
    } else if (actor.name === 'Evsw') {
        // EVent SWitch
    } else if (actor.name === 'TagSo' || actor.name === 'TagMSo') {
        // Tags for fishmen?
    } else if (actor.name === 'TagPo') {
        // Photo tags
    } else if (actor.name === 'LTag0' || actor.name === 'LTag1' || actor.name === 'LTagR0') {
        // Light tags?
    } else if (actor.name === 'kytag00' || actor.name === 'ky_tag0' || actor.name === 'ky_tag1' || actor.name === 'ky_tag2' || actor.name === 'kytag5' || actor.name === 'kytag6' || actor.name === 'kytag7') {
        // Environment tags (Kankyo)
    } else if (
        actor.name === 'TagEv' || actor.name === 'TagKb' || actor.name === 'TagIsl' || actor.name === 'TagMk' || actor.name === 'TagWp' || actor.name === 'TagMd' ||
        actor.name === 'TagHt' || actor.name === 'TagMsg' || actor.name === 'TagMsg2' || actor.name === 'ReTag0' ||
        actor.name === 'AttTag' || actor.name === 'AttTagB' ||
        actor.name === 'VolTag' || actor.name === 'WindTag') {
        // Other tags?
    } else if (actor.name === 'HyoiKam') {
        // Misc. gameplay data
    } else if (actor.name === 'MtFlag' || actor.name === 'SieFlag' || actor.name === 'Gflag' || actor.name === 'MjFlag') {
        // Flags (only contains textures)
    } else if (actor.name === 'Akabe') {
        // Collision
    } else {
        return false;
    }

    return true;
}

// TODO(jstpierre): Remove this.
export interface PlacedActor extends fopAcM_prm_class {
    // NOTE(jstpierre): This is normally passed separately.
    name: string;
    // TODO(jstpierre): Remove
    rotationY: number;
    roomRenderer: WindWakerRoomRenderer;
};

// Special-case actors

const bboxScratch = new AABB();
const screenProjection = new ScreenSpaceProjection();
export class BMDObjectRenderer {
    public visible = true;
    public modelMatrix: mat4 = mat4.create();
    public lightTevColorType = LightType.Actor;
    public layer: number;
    public tevstr = new dKy_tevstr_c();

    private childObjects: BMDObjectRenderer[] = [];
    private parentJointMatrix: mat4 | null = null;

    constructor(public modelInstance: J3DModelInstanceSimple) {
    }

    public bindANK1(ank1: ANK1, animationController?: AnimationController): void {
        this.modelInstance.bindANK1(ank1, animationController);
    }

    public bindTTK1(ttk1: TTK1, animationController?: AnimationController): void {
        this.modelInstance.bindTTK1(ttk1, animationController);
    }

    public bindTRK1(trk1: TRK1, animationController?: AnimationController): void {
        this.modelInstance.bindTRK1(trk1, animationController);
    }

    public bindTPT1(tpt1: TPT1, animationController?: AnimationController): void {
        this.modelInstance.bindTPT1(tpt1, animationController);
    }

    public setParentJoint(o: BMDObjectRenderer, jointName: string): void {
        this.parentJointMatrix = o.modelInstance.getJointToWorldMatrixReference(jointName);
        o.childObjects.push(this);
    }

    public setMaterialColorWriteEnabled(materialName: string, v: boolean): void {
        this.modelInstance.setMaterialColorWriteEnabled(materialName, v);
    }

    public setExtraTextures(extraTextures: ZWWExtraTextures): void {
        extraTextures.fillExtraTextures(this.modelInstance);

        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].setExtraTextures(extraTextures);
    }

    public prepareToRender(globals: dGlobals, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        if (globals.renderHacks.renderHacksChanged) {
            this.modelInstance.setVertexColorsEnabled(globals.renderHacks.vertexColorsEnabled);
            this.modelInstance.setTexturesEnabled(globals.renderHacks.texturesEnabled);
        }

        if (this.parentJointMatrix !== null) {
            mat4.mul(this.modelInstance.modelMatrix, this.parentJointMatrix, this.modelMatrix);
        } else {
            mat4.copy(this.modelInstance.modelMatrix, this.modelMatrix);

            // Don't compute screen area culling on child meshes (don't want heads to disappear before bodies.)
            bboxScratch.transform(this.modelInstance.modelData.bbox, this.modelInstance.modelMatrix);
            computeScreenSpaceProjectionFromWorldSpaceAABB(screenProjection, viewerInput.camera, bboxScratch);

            if (screenProjection.getScreenArea() <= 0.0002)
                return;
        }

        mat4.getTranslation(scratchVec3a, this.modelMatrix);
        settingTevStruct(globals, this.lightTevColorType, scratchVec3a, this.tevstr);
        setLightTevColorType(globals, this.modelInstance, this.tevstr, viewerInput.camera);

        this.modelInstance.prepareToRender(device, renderInstManager, viewerInput);
        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].prepareToRender(globals, device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].destroy(device);
    }
}

export async function loadActor(globals: dGlobals, roomRenderer: WindWakerRoomRenderer, processName: string, actor: PlacedActor): Promise<void> {
    // Attempt to find an implementation of this Actor in our table
    const objName = globals.dStage_searchName(processName);

    // New-style system.

    // This is supposed to be executing in the context of the stage, I believe.
    if (fpcSCtRq_Request(globals.frameworkGlobals, globals.scnPlay.layer, objName.pcName, actor))
        return;

    // Legacy actor system.
    actor.name = processName;
    const loaded = spawnLegacyActor(globals.renderer, roomRenderer, actor);
    if (loaded) {
        // Warn about legacy actors?
        // console.warn(`Legacy actor: ${actor.name} / ${roomRenderer.name} Layer ${actor.layer} / ${hexzero(actor.arg, 8)}`);
    } else {
        const dbgName = globals.objNameGetDbgName(objName);
        // console.warn(`Unknown obj: ${actor.name} / ${dbgName} / ${roomRenderer.name} Layer ${actor.layer}`);
    }
}
