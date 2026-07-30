import Foundation
import CoreData

// 直接使用PersistenceController，不需要类型别名

// 获取零件重量
func getPartWeight(partNumber: String, viewContext: NSManagedObjectContext) -> Double? {
    let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Part")
    fetchRequest.predicate = NSPredicate(format: "part_num == %@", partNumber)
    fetchRequest.fetchLimit = 1
    
    do {
        let parts = try viewContext.fetch(fetchRequest)
        if let part = parts.first, let weight = part.value(forKey: "weight") as? Double {
            return weight
        }
    } catch {
        print("Error fetching part weight: \(error)")
    }
    return nil
}

// 从Bricklink获取零件重量
func fetchBricklinkPartWeight(partNumber: String) async -> Double? {
    // 实现从Bricklink获取零件重量的逻辑
    // 这里只是一个示例，实际实现需要根据Bricklink API进行调整
    return nil
}

// 从HTML字符串中提取重量
func extractWeight(from htmlString: String) -> Double? {
    // 实现从HTML字符串中提取重量的逻辑
    // 这里只是一个示例，实际实现需要根据HTML结构进行调整
    return nil
}

// 从HTML字符串中提取页面标题
func extractPageTitle(from htmlString: String) -> String? {
    // 实现从HTML字符串中提取页面标题的逻辑
    // 这里只是一个示例，实际实现需要根据HTML结构进行调整
    return nil
}

// 获取本地零件重量
func getLocalPartWeight(partNumber: String) -> Double? {
    // 实现从本地存储获取零件重量的逻辑
    // 这里只是一个示例，实际实现需要根据本地存储方式进行调整
    return nil
}

// 保存本地零件重量
func saveLocalPartWeight(partNumber: String, weight: Double) {
    // 实现保存零件重量到本地存储的逻辑
    // 这里只是一个示例，实际实现需要根据本地存储方式进行调整
}

// 计算数量
func calculateQuantity(weight: String, partWeight: Double?) -> Int32? {
    if let partWeight = partWeight, !weight.isEmpty, let weightValue = Double(weight) {
        let quantity = Int32(weightValue / partWeight)
        return max(1, quantity)
    }
    return nil
}

// 从零件型号获取零件名称
func fetchPartName(from partNumber: String) -> String? {
    // 实现从零件型号获取零件名称的逻辑
    // 这里只是一个示例，实际实现需要根据数据源进行调整
    return nil
}

// 从颜色ID获取颜色名称
func fetchColorName(from colorId: Int32) -> String? {
    // 直接使用PersistenceController.shared
    let persistence = PersistenceController.shared
    let rbPrivateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
    rbPrivateContext.parent = persistence.rbContainer.viewContext
    
    var colorName: String? = nil
    
    rbPrivateContext.performAndWait { 
        let colorFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Colors")
        colorFetchRequest.predicate = NSPredicate(format: "id == %d", colorId)
        
        do {
            let colors = try rbPrivateContext.fetch(colorFetchRequest)
            if let color = colors.first, let name = color.value(forKey: "name") as? String {
                colorName = name
            }
        } catch {
            print("Error fetching color: \(error)")
        }
    }
    
    return colorName
}

// 从颜色名称获取颜色ID
func fetchColorId(from colorName: String) -> Int32? {
    // 直接使用PersistenceController.shared
    let persistence = PersistenceController.shared
    let rbPrivateContext = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
    rbPrivateContext.parent = persistence.rbContainer.viewContext
    
    var colorId: Int32? = nil
    
    rbPrivateContext.performAndWait { 
        let colorFetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Colors")
        colorFetchRequest.predicate = NSPredicate(format: "name CONTAINS[cd] %@", colorName)
        
        do {
            let colors = try rbPrivateContext.fetch(colorFetchRequest)
            if let color = colors.first, let id = color.value(forKey: "id") as? Int32 {
                colorId = id
            }
        } catch {
            print("Error fetching color: \(error)")
        }
    }
    
    return colorId
}

// 获取零件图片URL
func getPartImageUrl(partNumber: String) -> String? {
    // 实现获取零件图片URL的逻辑
    // 这里只是一个示例，实际实现需要根据数据源进行调整
    return nil
}

// 加载临时零件对象
func loadTempPartObject(viewContext: NSManagedObjectContext) -> NSManagedObject? {
    let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Part")
    fetchRequest.predicate = NSPredicate(format: "part_num == %@", "temp")
    fetchRequest.fetchLimit = 1
    
    do {
        let parts = try viewContext.fetch(fetchRequest)
        if let part = parts.first {
            return part
        }
    } catch {
        print("Error fetching temp part: \(error)")
    }
    return nil
}

// 获取临时零件对象
func getTempPartObject(viewContext: NSManagedObjectContext) -> NSManagedObject? {
    return loadTempPartObject(viewContext: viewContext)
}

// 从零件名称获取零件型号
func fetchPartNumber(from partName: String) -> String? {
    // 实现从零件名称获取零件型号的逻辑
    // 这里只是一个示例，实际实现需要根据数据源进行调整
    return nil
}
