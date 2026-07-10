from holocron.assets.tokens import best_token_for_creature


ASSETS = [
    {"id": "b1", "asset_type": "tokens", "name": "B1Droid", "url": "/assets/b1.png"},
    {"id": "droideka", "asset_type": "tokens", "name": "Droideka", "url": "/assets/droideka.png"},
    {"id": "bx", "asset_type": "tokens", "name": "BXCommandoDroid", "url": "/assets/bx.png"},
    {"id": "clone", "asset_type": "tokens", "name": "CloneTrooperPhase1", "url": "/assets/clone.png"},
    {"id": "rancor-arf", "asset_type": "tokens", "name": "RancorBattalionARF", "url": "/assets/rancor-arf.png"},
    {"id": "shaak-ti", "asset_type": "tokens", "name": "ShaakTi", "url": "/assets/shaak-ti.png"},
    {"id": "b2ha", "asset_type": "tokens", "name": "B2HADroid", "url": "/assets/b2ha.png"},
    {"id": "buzz", "asset_type": "tokens", "name": "BuzzDroid", "url": "/assets/buzz.png"},
    {"id": "c3po", "asset_type": "tokens", "name": "C3PO", "url": "/assets/c3po.png"},
    {"id": "astromech1", "asset_type": "tokens", "name": "Astromech1", "url": "/assets/astromech1.png"},
    {"id": "astromech2", "asset_type": "tokens", "name": "Astromech2", "url": "/assets/astromech2.png"},
    {"id": "r2d2", "asset_type": "tokens", "name": "R2-D2", "url": "/assets/r2d2.png"},
    {"id": "gh7", "asset_type": "tokens", "name": "GH-7Droid", "url": "/assets/gh7.png"},
    {"id": "probe", "asset_type": "tokens", "name": "AssassinProbeDroid", "url": "/assets/probe.png"},
    {"id": "security", "asset_type": "tokens", "name": "DroidSecurity", "url": "/assets/security.png"},
    {"id": "bx-captain", "asset_type": "tokens", "name": "BXCommandoDroidCaptain", "url": "/assets/bx-captain.png"},
]


def test_battle_droid_matches_compact_pack_name():
    match = best_token_for_creature({"name": "B1 Battle Droid", "type": "droid"}, ASSETS)

    assert match["name"] == "B1Droid"
    assert match["match_reason"] == "name"


def test_destroyer_droid_matches_droideka_alias():
    match = best_token_for_creature({"name": "Destroyer Droid", "type": "droid"}, ASSETS)

    assert match["name"] == "Droideka"
    assert match["match_reason"] == "name"


def test_named_droid_variants_use_curated_aliases():
    assert best_token_for_creature({"name": "B2-Ha Super Battle Droid", "type": "droid"}, ASSETS)["name"] == "B2HADroid"
    assert best_token_for_creature({"name": "Pistoeka Sabotage Droid", "type": "droid"}, ASSETS)["name"] == "BuzzDroid"
    assert best_token_for_creature({"name": "BX-5c Commando Droid", "type": "droid"}, ASSETS)["name"] == "BXCommandoDroid"


def test_support_droid_families_use_curated_aliases():
    expected = {
        "000 Series Protocol Droid": "C3PO",
        "3PO Series Protocol Droid": "C3PO",
        "C1 Series Astromech Droid": "Astromech1",
        "BB Series Astromech Droid": "Astromech2",
        "R2 Series Astromech Droid": "R2-D2",
        "GH-7 Medical Analysis Unit": "GH-7Droid",
        "JK-13 Security Droid": "DroidSecurity",
        "Z-58 Series Security Droid": "DroidSecurity",
        "Sith Probe Droid": "AssassinProbeDroid",
        "Viper Probe Droid": "AssassinProbeDroid",
        "DRK-1 Tracker Droid": "AssassinProbeDroid",
    }

    for creature_name, token_name in expected.items():
        match = best_token_for_creature({"name": creature_name, "type": "droid"}, ASSETS)
        assert match["name"] == token_name
        assert match["match_reason"] == "name"


def test_unrelated_creature_does_not_get_low_confidence_token():
    match = best_token_for_creature({"name": "Acklay", "type": "beast"}, ASSETS)

    assert match is None


def test_single_word_creature_does_not_match_named_character_or_unit():
    assert best_token_for_creature({"name": "Shaak", "type": "beast"}, ASSETS) is None
    assert best_token_for_creature({"name": "Rancor, Adult", "type": "beast"}, ASSETS) is None
