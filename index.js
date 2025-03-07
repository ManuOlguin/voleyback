import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
import { createClient } from "@supabase/supabase-js";
const supabaseUrl = "https://fztuknypyqcffuqkarsc.supabase.co";
const supabaseKey = process.env.SUPABASE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
    origin: "*",
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.use(express.json());

app.get("/", (req, res) => {
    res.send("Backend is running!");
});

app.listen(port, () => {
    console.log(`Backend is running on http://localhost:${port}`);
});

app.get("/api/fullMatches", async (req, res) => {
    try {
        let { data: matches, error: matchesError } = await supabase
            .from("matches")
            .select(`
                id, 
                date,
                season_id,
                sets (
                    id, 
                    team1_score, 
                    team2_score, 
                    winner_known, 
                    set_order,
                    elo_history (
                        player_id,
                        change)
                ),
                teams (
                    id, 
                    team_number,
                    team_player (
                        player_id,
                        players (id, name, elo)
                    )
                )
            `);

        if (matchesError) throw matchesError;

        if (!matches) {
            throw new Error("No matches found");
        }

        res.status(200).json(matches);
    } catch (error) {
        console.error("Error fetching matches:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/keepalive", async (req, res) => {
    const { data, error } = await supabase.from('players').select('*').limit(1);
    if (error) {
      console.error('Error keeping Supabase alive:', error);
    } else {
      console.log('Supabase is alive:', data);
    }
});

app.post("/recalcular", async (req, res) => {
    try {
        console.log("Request body:", req.body);
        const { seasonId } = req.body;

        let { data: matchIds, error: matchIdsError } = await supabase
            .from("matches")
            .select("id")
            .eq("season_id", seasonId);

        if (matchIdsError) throw matchIdsError;

        if (!Array.isArray(matchIds)) {
            throw new Error("matchIds is not an array");
        }

        const { data: setIds, error: setIdsError } = await supabase
            .from("sets")
            .select("id")
            .in("match_id", matchIds.map(match => match.id));

        if (setIdsError) throw setIdsError;

        let { error: deleteEloHistoryError } = await supabase
            .from("elo_history")
            .delete()
            .in("set_id", setIds.map(set => set.id));

        if (deleteEloHistoryError) throw deleteEloHistoryError;

        const { error: resetEloError } = await supabase
            .from("players")
            .update({ elo: 1000 })
            .neq("elo", 1000);

        if (resetEloError) throw resetEloError;

        for (const matchId of matchIds) {
            console.log("Recalculating ELO for match ID:", matchId.id);
            await calculateElo(matchId.id);
        }

        res.send("Elo calculations completed for all matches");
    } catch (error) {
        console.error("Error in recalculating ELO:", error);
        res.status(500).send(error.message);
    }
});

app.get("/api/fullPlayers", async (req, res) => {
    try {
        let { data: players, error } = await supabase.from("players").select("*");

        if (error) throw error;
        console.log("Players:", players);
        res.status(200).json(players);
    } catch (error) {
        console.error("Error fetching players:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post("/api/addMatch", async (req, res) => {
    try {
        const season = 1;
        const { date, team1Players, team2Players, setsData } = req.body;
        console.log("Match data:", req.body);
        const idMatchisto = await addMatchToDatabase(
            date,
            season,
            team1Players,
            team2Players,
            setsData
        );
        await calculateElo(idMatchisto);

        res.status(201).json({ message: "Match added successfully!" });
    } catch (error) {
        console.error("Error adding match:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get("/pruebita", async (req, res) => {
    try {
        await calculateElo(48);
        res.send("Elo calculation completed");
    } catch (error) {
        res.status(500).send(error.message);
    }
});

async function addMatchToDatabase(
    date,
    season,
    team1Players,
    team2Players,
    setsData
) {
    const { data: matchData, error: matchError } = await supabase
        .from("matches")
        .insert([{ date, season_id: season }])
        .select()
        .single();

    if (matchError) throw matchError;
    const match_id = matchData.id;

    const { data: teamsData, error: teamsError } = await supabase
        .from("teams")
        .insert([
            { match_id, team_number: 1 },
            { match_id, team_number: 2 },
        ])
        .select();

    if (teamsError) throw teamsError;

    const team1_id = teamsData.find((team) => team.team_number === 1).id;
    const team2_id = teamsData.find((team) => team.team_number === 2).id;

    const teamPlayerInsertions = [
        ...(Array.isArray(team1Players)
            ? team1Players.map((player_id) => ({
                team_id: team1_id,
                player_id,
                position: setsData.map((set) => {
                    const pos = set.team1Positions.indexOf(player_id.toString());
                    return pos === 0
                        ? "A"
                        : pos === 1
                            ? "O"
                            : pos === 2 || pos === 3
                                ? "P"
                                : pos === 4 || pos === 5
                                    ? "C"
                                    : "";
                }),
            }))
            : []),
        ...(Array.isArray(team2Players)
            ? team2Players.map((player_id) => ({
                team_id: team2_id,
                player_id,
                position: setsData.map((set) => {
                    const pos = set.team2Positions.indexOf(player_id.toString());
                    return pos === 0
                        ? "A"
                        : pos === 1
                            ? "O"
                            : pos === 2 || pos === 3
                                ? "P"
                                : pos === 4 || pos === 5
                                    ? "C"
                                    : "";
                }),
            }))
            : []),
    ];
    console.log(
        "Team player insertions:",
        team1Players,
        team2Players,
        teamPlayerInsertions
    );

    const { error: playersError } = await supabase
        .from("team_player")
        .insert(teamPlayerInsertions);

    if (playersError) throw playersError;

    const setInsertions = setsData.map((set) => ({
        match_id,
        team1_score: set.team1_score,
        team2_score: set.team2_score,
        winner_known: set.winner === "team1" ? 1 : 2,
        ignore_for_elo: set.ignore_for_elo,
        set_order: set.set_order,
    }));
    console.log("Set insertions:", setInsertions);

    const { error: setsError } = await supabase.from("sets").insert(setInsertions);

    if (setsError) throw setsError;

    return match_id;
}

async function calculateElo(matchId) {
    let { data, error } = await supabase
        .from("teams")
        .select(
            `
                id,
                team_number,
                team_player (
                    id,
                    players (
                        id,
                        name,
                        elo
                    )
                )
            `
        )
        .eq("match_id", matchId);

    let { data: sets, error: error2 } = await supabase
        .from("sets")
        .select("*")
        .eq("match_id", matchId)
        .order("id", { ascending: true });

    console.log("Sets:", sets);

    if (data && data.length > 0) {
        if (sets) {
            const playerData = data && data.length > 0
                ? data.flatMap((team) => team.team_player.map((tp) => tp.players))
                : [];

            console.log("Player data:", playerData);
            const playerEloChangesGlobal = [];

            for (let k = 0; k <= sets.length - 1; k++) {
                const playerEloChanges = [];
                let promedio1 = 0;
                let promedio2 = 0;

                for (let j = 0; j <= playerData.length - 1; j++) {
                    if (j <= 5) {
                        promedio1 += playerData[j].elo / 6;
                        console.log("Equipo " + 1 + " " + playerData[j].elo);
                    } else if (j > 5) {
                        promedio2 += playerData[j].elo / 6;
                        console.log("Equipo " + 2 + " " + playerData[j].elo);
                    }
                }

                let probabilidad1 = 1 / (1 + Math.pow(10, (-promedio2 + promedio1) / 600));
                let probabilidad2 = 1 / (1 + Math.pow(10, (-promedio1 + promedio2) / 600));

                console.log("Probabilidad" + " " + probabilidad1 + " " + probabilidad2 + " con dif " + Math.abs(promedio1 - promedio2) + " ");

                let team1_score = sets[k].team1_score !== null ? sets[k].team1_score : 1;
                let team2_score = sets[k].team2_score !== null ? sets[k].team2_score : 1;

                for (let j = 0; j <= playerData.length - 1; j++) {
                    let correccion = 0;
                    if (sets[k].winner_known === 1) {
                        correccion = Math.pow(team1_score / team2_score, 0.18);
                    } else if (sets[k].winner_known === 2) {
                        correccion = Math.pow(team2_score / team1_score, 0.18);
                    } else {
                        console.log("Error en correccion");
                        break;
                    }
                    console.log("Team scores:", team1_score, team2_score);
                    console.log("Correccion:", correccion);

                    let n = 0;
                    let w = 0.035;

                    switch (true) {
                        case promedio1 === promedio2:
                            n = 14;
                            break;
                        case promedio1 > promedio2 && sets[k].winner_known === 1:
                            n = 21 - (21 - 7) * (1 - Math.exp(-w * Math.abs(promedio1 - promedio2)));
                            break;
                        case promedio1 > promedio2 && sets[k].winner_known === 2:
                            n = 7 + (21 - 7) * (1 - Math.exp(-w * Math.abs(promedio1 - promedio2)));
                            break;
                        case promedio1 < promedio2 && sets[k].winner_known === 1:
                            n = 7 + (21 - 7) * (1 - Math.exp(-w * Math.abs(promedio1 - promedio2)));
                            break;
                        case promedio1 < promedio2 && sets[k].winner_known === 2:
                            n = 21 - (21 - 7) * (1 - Math.exp(-w * Math.abs(promedio1 - promedio2)));
                            break;
                        default:
                            console.log("Error en n");
                    }
                    console.log("N" + " " + n);
                    let tuvieja = playerData[j].elo;
                    switch (true) {
                        case j <= 5 && sets[k].winner_known === 1:
                            playerData[j].elo += n * (1 - probabilidad1);
                            break;
                        case j > 5 && sets[k].winner_known === 1:
                            playerData[j].elo += n * (0 - probabilidad2);
                            break;
                        case j <= 5 && sets[k].winner_known === 2:
                            playerData[j].elo += n * (0 - probabilidad1)
                            break;
                        case j > 5 && sets[k].winner_known === 2:
                            playerData[j].elo += n * (1 - probabilidad2);
                            break;
                        default:
                            console.log("Error en aplicar elo");
                            break;
                    }

                    if (j !== 5) {
                        console.log(
                            "El jugador: " +
                            playerData[j].name +
                            " con Equipo: " +
                            (j <= 5 ? 1 : 2) +
                            " " +
                            team1_score +
                            " contra " +
                            team2_score +
                            " en set numero " +
                            (k + 1) +
                            " con diferencia de elo " +
                            (playerData[j].elo - tuvieja)
                        );
                    }
                    playerEloChanges.push({
                        playerId: playerData[j].id,
                        eloChange: playerData[j].elo - tuvieja,
                    });
                    const existingChange = playerEloChangesGlobal.find(change => change.playerId === playerData[j].id);
                    if (existingChange) {
                        existingChange.eloChange += (playerData[j].elo - tuvieja);
                    } else {
                        playerEloChangesGlobal.push({
                            playerId: playerData[j].id,
                            eloChange: playerData[j].elo - tuvieja,
                        });
                    }
                }
                const eloHistoryInsertions = playerData.map(player => ({
                    player_id: player.id,
                    set_id: sets[k].id,
                    change: playerEloChanges.find(playerEloChanges => playerEloChanges.playerId === player.id)?.eloChange ?? 0,
                }));

                const { error: eloHistoryError } = await supabase
                    .from("elo_history")
                    .insert(eloHistoryInsertions);

                if (eloHistoryError) throw eloHistoryError;
            }
            for (let j = 0; j < playerData.length; j++) {
                console.log(
                    ` ELO DE :) ${playerData[j].name}: ${playerData[j].elo}`
                );
            }
            const playerUpdates = playerEloChangesGlobal.map(change => ({
                id: change.playerId,
                elo: playerData.find(player => player.id === change.playerId)?.elo ?? 0
            }));

            const { error: updateError } = await supabase
                .from("players")
                .upsert(playerUpdates, { onConflict: "id" });

            if (updateError) throw updateError;
            console.log("Player elo changes:", playerEloChangesGlobal);
        }
    } else {
        throw new Error(
            "No players found " + error?.message + " " + error2?.message
        );
    }
}
