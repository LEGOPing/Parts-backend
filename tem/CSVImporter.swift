import SwiftUI
import CoreData

class CSVImporter {
    static let shared = CSVImporter()
    
    private init() {}
    
    // 解析CSV文件并导入数据到RB数据库
    func parseCSVFileToRB(_ url: URL, context: NSManagedObjectContext, progressCallback: @escaping (Double) -> Void) throws -> Int {
        // 读取CSV文件内容
        let content = try String(contentsOf: url, encoding: .utf8)
        
        // 解析CSV内容
        let rows = parseCSVContent(content)
        
        // 检查是否有数据
        guard !rows.isEmpty else {
            throw NSError(domain: "CSVImporter", code: 1, userInfo: [NSLocalizedDescriptionKey: "CSV文件为空"])
        }
        
        // 第一行是表头
        let headers = rows[0]
        
        // 确保表头不为空
        guard !headers.isEmpty else {
            throw NSError(domain: "CSVImporter", code: 2, userInfo: [NSLocalizedDescriptionKey: "CSV文件表头为空"])
        }
        
        // 确定表名
        let tableName = getTableName(from: url)
        
        // 确保表名有效
        guard !tableName.isEmpty else {
            throw NSError(domain: "CSVImporter", code: 3, userInfo: [NSLocalizedDescriptionKey: "无法确定CSV文件对应的表名"])
        }
        
        // 获取字段顺序
        let fieldOrder = getFieldOrder(for: tableName)
        
        // 确保字段顺序不为空
        guard !fieldOrder.isEmpty else {
            throw NSError(domain: "CSVImporter", code: 4, userInfo: [NSLocalizedDescriptionKey: "无法获取字段顺序"])
        }
        
        // 确保实体存在
        createEntityIfNotExists(entityName: tableName, context: context, headers: headers)
        
        // 导入数据
        var successfulImports = 0
        
        for (index, row) in rows.enumerated() {
            // 跳过表头
            if index == 0 {
                continue
            }
            
            // 创建新实体
            let entity = NSEntityDescription.insertNewObject(forEntityName: tableName, into: context)
            
            // 填充数据
            for (fieldIndex, fieldName) in fieldOrder.enumerated() {
                if fieldIndex < row.count {
                    let value = row[fieldIndex]
                    setValueForField(entity: entity, fieldName: fieldName, value: value)
                }
            }
            
            successfulImports += 1
            
            // 计算进度
            let progress = Double(index) / Double(rows.count)
            progressCallback(progress)
        }
        
        return successfulImports
    }
    
    // 从URL中获取表名
    private func getTableName(from url: URL) -> String {
        let fileName = url.lastPathComponent
        let tableName = fileName.components(separatedBy: ".").first ?? ""
        return tableName
    }
    
    // 设置字段值
    func setValueForField(entity: NSManagedObject, fieldName: String, value: String) {
        let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        
        // 检查字段是否存在
        guard entity.entity.propertiesByName.keys.contains(fieldName) else {
            print("字段 \(fieldName) 不存在于实体中")
            return
        }
        
        // 根据字段类型设置值
        if let attributeDescription = entity.entity.propertiesByName[fieldName] as? NSAttributeDescription {
            switch attributeDescription.attributeType {
            case .stringAttributeType:
                entity.setValue(trimmedValue, forKey: fieldName)
            case .integer32AttributeType:
                let intValue = extractNumericValue(trimmedValue)
                entity.setValue(intValue, forKey: fieldName)
            case .integer64AttributeType:
                let intValue = Int64(extractNumericValue(trimmedValue))
                entity.setValue(intValue, forKey: fieldName)
            case .doubleAttributeType:
                if let doubleValue = Double(trimmedValue) {
                    entity.setValue(doubleValue, forKey: fieldName)
                }
            case .booleanAttributeType:
                let boolValue = trimmedValue.lowercased() == "true" || trimmedValue == "1"
                entity.setValue(boolValue, forKey: fieldName)
            default:
                entity.setValue(trimmedValue, forKey: fieldName)
            }
        }
    }
    
    // 转换为驼峰命名
    func convertToCamelCase(_ snakeCase: String) -> String {
        let components = snakeCase.components(separatedBy: "_")
        var camelCase = components[0].lowercased()
        
        for component in components.dropFirst() {
            camelCase += component.prefix(1).uppercased() + component.dropFirst().lowercased()
        }
        
        return camelCase
    }
    
    // 提取数值
    func extractNumericValue(_ value: String) -> Int32 {
        let numericString = value.filter { $0.isNumber }
        return Int32(numericString) ?? 0
    }
    
    // 解析CSV文件内容
    func parseCSVContent(_ content: String) -> [[String]] {
        let lines = content.components(separatedBy: .newlines)
        var rows: [[String]] = []
        
        for line in lines {
            let trimmedLine = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmedLine.isEmpty {
                let row = parseCSVLine(trimmedLine)
                rows.append(row)
            }
        }
        
        return rows
    }
    
    // 解析CSV行
    func parseCSVLine(_ line: String) -> [String] {
        var result: [String] = []
        var currentField: String = ""
        var inQuotes = false
        
        for character in line {
            if character == "\"" {
                inQuotes.toggle()
            } else if character == "," && !inQuotes {
                result.append(currentField)
                currentField = ""
            } else {
                currentField.append(character)
            }
        }
        
        result.append(currentField)
        return result
    }
    
    // 获取字段顺序
    func getFieldOrder(for tableName: String) -> [String] {
        switch tableName {
        case "Colors":
            return ["id", "name", "rgb", "is_trans"]
        case "Parts":
            return ["part_num", "name", "part_cat_id", "part_material_id"]
        case "Elements":
            return ["element_id", "part_num", "color_id", "design_id"]
        case "Categories":
            return ["id", "name", "parent_id"]
        case "Materials":
            return ["id", "name"]
        default:
            return []
        }
    }
    
    // 确保实体存在
    func createEntityIfNotExists(entityName: String, context: NSManagedObjectContext, headers: [String]) {
        let entityDescription = NSEntityDescription.entity(forEntityName: entityName, in: context)
        guard entityDescription != nil else {
            print("实体 \(entityName) 不存在")
            return
        }
    }
}
