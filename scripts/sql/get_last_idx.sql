-- Drop the temp table if it exists to avoid errors on re-runs
DROP TABLE IF EXISTS tmp_results;

-- Create a temporary table to store results
CREATE TEMP TABLE tmp_results (
    entity_name text,
    max_value text
);

DO $$
DECLARE
    rec record;
    _current_table_name text;
    _column_name text;
    query text := '';
    skip_tables text[] := ARRAY[]::text[];  -- Ensure this contains your specific tables to skip if necessary
    column_overrides jsonb := '{"Sessions": "sid", "department_supervisors": "user_id"}'; -- Override column names as needed
BEGIN
    FOR rec IN SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_type = 'BASE TABLE'
                AND table_name <> ALL(skip_tables)
    LOOP
        _current_table_name := rec.table_name;
        _column_name := COALESCE(column_overrides->>_current_table_name, 'id');

        IF query <> '' THEN
            query := query || ' UNION ALL ';
        END IF;

        -- Cast all max_value to text to avoid type mismatch in UNION
        query := query || format('SELECT ''%s'' AS table_name, CAST(MAX(%I) AS text) AS max_value FROM %I', _current_table_name, _column_name, _current_table_name);
    END LOOP;

    FOR rec IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'
    LOOP
        IF query <> '' THEN
            query := query || ' UNION ALL ';
        END IF;
        -- Here last_value is assumed to be numeric but cast to text to match other parts of the UNION
        query := query || format('SELECT ''%s'' AS sequence_name, CAST(last_value AS text) FROM %I', rec.sequence_name, rec.sequence_name);
    END LOOP;

    EXECUTE 'INSERT INTO tmp_results ' || query;
END $$;

SELECT * FROM tmp_results;