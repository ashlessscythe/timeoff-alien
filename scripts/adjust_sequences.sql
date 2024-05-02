DO $$
DECLARE
    rec record;
    _table_name text;
    _seq_name text;
    _column_name text := 'id';  -- Assuming 'id' is the standard column name
    _max_id_query text;
    _setval_query text;
    _tables_to_process text[] := ARRAY['users', 'audit', 'comments', 'email_audits', 'leave_types', 'leaves'];  -- Specify the list of tables to process
    _column_overrides jsonb := '{"Sessions": "sid", "department_supervisors": "user_id"}'; -- Override column names as needed
BEGIN
    FOR rec IN SELECT sequence_name,
                      replace(sequence_name, '_id_seq', '') AS related_table
                FROM information_schema.sequences
                WHERE sequence_schema = 'public'
                  AND replace(sequence_name, '_id_seq', '') = ANY(_tables_to_process)
    LOOP
        _seq_name := rec.sequence_name;
        _table_name := rec.related_table;
        _column_name := COALESCE(_column_overrides->>_table_name, 'id');

        -- Prepare the query to find the maximum id in the related table
        _max_id_query := format('SELECT COALESCE(MAX(%I) + 1, 0) FROM %I', _column_name, _table_name);

        -- Prepare the setval query to adjust the sequence
        _setval_query := format('SELECT setval(''%I'', (%s), true)', _seq_name, _max_id_query);

        -- Execute the setval query to adjust the sequence based on max id
        EXECUTE _setval_query;
    END LOOP;
END $$;
